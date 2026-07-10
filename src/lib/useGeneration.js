import { useCallback } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { PROVIDERS, buildFullPrompt, buildEditPrompt, callProvider, resizeImageDataURL, buildFallbackArt } from './providers.js';
import { fetchBankCardTemplate, composeEmbosserReadyArtwork } from './bankTemplate.js';

const VARIATION_COUNT = 3;
const bankTemplateCache = { current: null };

// Backend-only — builds embosser-ready composite for the currently selected variation.
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

export function useGeneration() {
  const {
    source, uploaded, selections, freeText, cardOrientation,
    settings, hasGeneratedRef, seedRef,
    setVariations, setSelectedVariation, setAiLoading, setAiLoadingText,
    setErrorBanner, setRegenCount, setLastPrompt, showToast,
  } = useApp();

  const generate = useCallback(async () => {
    if (hasGeneratedRef.current) {
      setRegenCount((c) => c + 1);
    }
    hasGeneratedRef.current = true;

    setErrorBanner('');
    const isEdit = source === 'upload' && !!uploaded;
    const providerLabel = PROVIDERS[settings.provider]?.label || 'AI';

    const prompt = isEdit ? buildEditPrompt(selections, freeText) : buildFullPrompt(selections, freeText);
    setLastPrompt(prompt);

    console.log(
      '[image generation] mode=%s provider=%s count=%d prompt=%s',
      isEdit ? 'image-to-image' : 'text-to-image',
      settings.provider, VARIATION_COUNT, prompt,
    );

    setAiLoading(true);
    setAiLoadingText(
      isEdit
        ? `Stylizing your photo with ${providerLabel} (×${VARIATION_COUNT})…`
        : `Generating with ${providerLabel} (×${VARIATION_COUNT})…`,
    );

    if (isEdit && settings.provider !== 'gemini') {
      setErrorBanner(
        `⚠ ${providerLabel} does not support image-to-image in this prototype. ` +
        `Switch to Google Gemini in the Ops Dashboard for true photo stylization. ` +
        `Falling back to text-to-image — your uploaded photo will NOT influence the result.`,
      );
    }

    let inputImage = null;
    if (isEdit && settings.provider === 'gemini') {
      try {
        inputImage = await resizeImageDataURL(uploaded.dataURL, 1024, 0.9);
      } catch (err) {
        setErrorBanner(`✕ Failed to prepare uploaded image: ${err.message}`);
        setAiLoading(false);
        return;
      }
    }

    const orientation = cardOrientation || 'horizontal';

    const tasks = Array.from({ length: VARIATION_COUNT }, (_, i) =>
      callProvider(settings, prompt, inputImage, orientation, seedRef).catch((err) => {
        console.error(`[image generation] variation ${i + 1} failed`, err);
        return { error: err.message };
      }),
    );
    const results = await Promise.all(tasks);

    const successes = results.filter(r => r && r.src);
    const failures  = results.filter(r => r && r.error);

    setAiLoading(false);

    // Demo-safe fallback: never leave the customer with an empty/failed card.
    // Any variation that failed is replaced with on-brand offline artwork so the
    // journey always continues. Real errors are still logged to the console.
    const built = results.map((r, i) => {
      let src = r && r.src ? r.src : null;
      if (!src) {
        const fb = buildFallbackArt(selections, orientation, (seedRef.current || 1) + i);
        src = fb.src;
      }
      return {
        src,
        cache: {
          horizontal: orientation === 'horizontal' ? src : null,
          vertical:   orientation === 'vertical'   ? src : null,
        },
      };
    });
    setVariations(built);
    setSelectedVariation(0);

    if (successes.length === 0) {
      setErrorBanner('');
      showToast('warn', `${providerLabel} is unreachable right now — showing sample artwork so you can keep going.`);
    } else if (failures.length > 0) {
      setErrorBanner('');
      showToast('warn', `${successes.length} of ${VARIATION_COUNT} designs generated — the rest use sample artwork.`);
    }

    // backend-only embosser compositing (fire and forget)
    if (built[0]) prepareEmbosserOutput(built[0]);
  }, [
    source, uploaded, selections, freeText, cardOrientation, settings,
    hasGeneratedRef, seedRef,
    setAiLoading, setAiLoadingText, setErrorBanner, setLastPrompt,
    setRegenCount, setVariations, setSelectedVariation, showToast,
  ]);

  const ensureOrientation = useCallback(async (variations, index, orient, setVariationsFn) => {
    const v = variations?.[index];
    if (!v || v.failed) return;
    if (!v.cache) v.cache = { horizontal: null, vertical: null };
    if (v.cache[orient]) {
      setVariationsFn((cur) => cur.map((x, i) => i === index ? { ...x, src: x.cache[orient] } : x));
      prepareEmbosserOutput({ ...v, src: v.cache[orient] });
      return;
    }

    const providerLabel = PROVIDERS[settings.provider]?.label || 'AI';
    setAiLoading(true);
    setAiLoadingText(`Re-rendering for ${orient} card with ${providerLabel}…`);

    try {
      const isEdit = source === 'upload' && !!uploaded;
      let inputImage = null;
      if (isEdit && settings.provider === 'gemini') {
        inputImage = await resizeImageDataURL(uploaded.dataURL, 1024, 0.9);
      }
      const result = await callProvider(settings, /* lastPrompt */ buildFullPrompt(selections, freeText), inputImage, orient, seedRef);
      if (!result?.src) throw new Error('Provider returned no image');
      setVariationsFn((cur) => cur.map((x, i) => i === index
        ? { ...x, src: result.src, cache: { ...(x.cache || {}), [orient]: result.src } }
        : x));
      prepareEmbosserOutput({ ...v, src: result.src });
    } catch (err) {
      console.error('[orient] regenerate failed', err);
      showToast('fail', `Could not render ${orient} card: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }, [source, uploaded, selections, freeText, settings, seedRef, setAiLoading, setAiLoadingText, showToast]);

  return { generate, ensureOrientation, VARIATION_COUNT };
}
