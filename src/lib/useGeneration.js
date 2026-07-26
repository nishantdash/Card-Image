import { useCallback } from 'react';
import { useApp } from '../context/AppContext.jsx';
import {
  PROVIDERS, IS_SERVER_ENFORCED, requestGeneration, resizeImageDataURL, buildFallbackArt,
} from './providers.js';
import { fetchBankCardTemplate, composeEmbosserReadyArtwork } from './bankTemplate.js';

const VARIATION_COUNT = 3;
const bankTemplateCache = { current: null };

// Backend-only — builds embosser-ready composite for the selected variation.
async function prepareEmbosserOutput(variation) {
  if (!variation?.src) return null;
  try {
    if (!bankTemplateCache.current || bankTemplateCache.current.code !== 'AU_BANK') {
      bankTemplateCache.current = await fetchBankCardTemplate('AU_BANK');
    }
    return await composeEmbosserReadyArtwork(bankTemplateCache.current, variation.src);
  } catch (err) {
    console.warn('[embosser] prepare failed:', err.message);
    return null;
  }
}

function toVariation(src, orientation) {
  return {
    src,
    cache: {
      horizontal: orientation === 'horizontal' ? src : null,
      vertical:   orientation === 'vertical'   ? src : null,
    },
  };
}

export function useGeneration() {
  const {
    source, uploaded, selections, freeText, cardOrientation, cardholderName,
    settings, hasGeneratedRef, seedRef,
    setVariations, setSelectedVariation, setAiLoading, setAiLoadingText,
    setErrorBanner, recordIteration, setLastPrompt, showToast, setVerdictToken,
  } = useApp();

  /**
   * Request generation.
   *
   * Returns the authoritative verdict so the caller can route on it. Crucially,
   * this no longer runs concurrently with moderation — the request itself is
   * what applies the guardrails, and a refusal produces no artwork at all.
   */
  const generate = useCallback(async ({ signal } = {}) => {
    hasGeneratedRef.current = true;
    setErrorBanner('');

    const isEdit = source === 'upload' && !!uploaded;
    const orientation = cardOrientation || 'horizontal';

    // Counted at dispatch, not on success: a run that fails or is refused by
    // moderation still consumed an attempt, and that is what ops needs to see.
    recordIteration(orientation);
    setAiLoading(true);
    setAiLoadingText(
      isEdit
        ? `Stylizing your photo (×${VARIATION_COUNT})…`
        : `Generating your design (×${VARIATION_COUNT})…`,
    );

    let inputImage = null;
    if (isEdit) {
      try {
        inputImage = await resizeImageDataURL(uploaded.dataURL, 1024, 0.9);
      } catch (err) {
        setAiLoading(false);
        setErrorBanner(`✕ Failed to prepare uploaded image: ${err.message}`);
        return { images: [], verdict: null, refused: false, error: err.message };
      }
    }

    if (isEdit && !IS_SERVER_ENFORCED && settings.provider !== 'gemini') {
      setErrorBanner(
        `⚠ ${PROVIDERS[settings.provider]?.label || 'This provider'} does not support ` +
        `image-to-image in local direct mode. Your photo will not influence the result.`,
      );
    }

    let result;
    let transportError = null;
    try {
      result = await requestGeneration({
        settings, selections, freeText, cardholderName, orientation,
        inputImage, variations: VARIATION_COUNT, seedRef, signal,
      });
    } catch (err) {
      // Cancellation is a deliberate customer action, not a failure: no error
      // banner, and crucially no fallback artwork — showing sample art here would
      // make a cancelled run look like it succeeded.
      if (err.name === 'AbortError') {
        setAiLoading(false);
        return { images: [], verdict: null, refused: false, cancelled: true };
      }
      console.error('[generation] request failed', err);
      transportError = err;
      // A transport failure is not a refusal. Keep the server's verdict if it
      // sent one (e.g. a 503 for missing configuration) and fall through to the
      // offline-artwork path below, so a demo survives an unreachable backend.
      result = { images: [], verdict: err.verdict ?? null, refused: false };
    }

    setAiLoading(false);
    setLastPrompt(result.verdict?.prompt || '');
    // Only a successful, allowed generation yields a token; a refusal must not
    // leave a stale one behind that could be replayed on submit.
    setVerdictToken(result.refused ? null : (result.verdict?.verdictToken ?? null));

    // A refusal must not produce artwork. Showing placeholder art here would
    // render a compliance block as a successful design.
    if (result.refused) {
      setVariations([]);
      setSelectedVariation(0);
      return result;
    }

    const built = result.images.map(src => toVariation(src, orientation));

    // Offline fallback applies only to provider failures on an ALLOWED
    // submission, so a live demo survives an unreachable provider.
    if (built.length === 0) {
      const seed = seedRef.current || 1;
      for (let i = 0; i < VARIATION_COUNT; i++) {
        built.push(toVariation(buildFallbackArt(selections, orientation, seed + i).src, orientation));
      }
      showToast('warn', 'Image service is unreachable right now — showing sample artwork so you can keep going.');
      if (transportError) {
        setErrorBanner(`⚠ ${transportError.message}`);
      }
    } else if (built.length < VARIATION_COUNT) {
      showToast('warn', `${built.length} of ${VARIATION_COUNT} designs generated.`);
    }

    setVariations(built);
    setSelectedVariation(0);
    if (built[0]) prepareEmbosserOutput(built[0]);

    return result;
  }, [
    source, uploaded, selections, freeText, cardOrientation, cardholderName, settings,
    hasGeneratedRef, seedRef, setAiLoading, setAiLoadingText, setErrorBanner,
    setLastPrompt, recordIteration, setVariations, setSelectedVariation, showToast,
    setVerdictToken,
  ]);

  const ensureOrientation = useCallback(async (variations, index, orient, setVariationsFn) => {
    const v = variations?.[index];
    if (!v || v.failed) return;
    if (!v.cache) v.cache = { horizontal: null, vertical: null };
    if (v.cache[orient]) {
      setVariationsFn(cur => cur.map((x, i) => (i === index ? { ...x, src: x.cache[orient] } : x)));
      prepareEmbosserOutput({ ...v, src: v.cache[orient] });
      return;
    }

    // A cache hit returned above without a provider call, so only a real
    // re-render is counted — this is the orientation-switch iteration the old
    // counter missed entirely.
    recordIteration(orient);
    setAiLoading(true);
    setAiLoadingText(`Re-rendering for ${orient} card…`);
    try {
      const isEdit = source === 'upload' && !!uploaded;
      let inputImage = null;
      if (isEdit) inputImage = await resizeImageDataURL(uploaded.dataURL, 1024, 0.9);

      const result = await requestGeneration({
        settings, selections, freeText, cardholderName, orientation: orient,
        inputImage, variations: 1, seedRef,
      });
      // Re-rendering runs the same guardrails; a refusal here is still a refusal.
      if (result.refused) {
        showToast('fail', 'This design can no longer be generated — it was blocked by moderation.');
        return;
      }
      const src = result.images[0];
      if (!src) throw new Error('No image returned');
      setVariationsFn(cur => cur.map((x, i) => (i === index
        ? { ...x, src, cache: { ...(x.cache || {}), [orient]: src } }
        : x)));
      prepareEmbosserOutput({ ...v, src });
    } catch (err) {
      console.error('[orient] regenerate failed', err);
      showToast('fail', `Could not render ${orient} card: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }, [
    source, uploaded, selections, freeText, cardholderName, settings, seedRef,
    setAiLoading, setAiLoadingText, showToast, recordIteration,
  ]);

  return { generate, ensureOrientation, VARIATION_COUNT };
}
