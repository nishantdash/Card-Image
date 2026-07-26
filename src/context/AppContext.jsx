import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { fetchQueue } from '../lib/opsApi.js';

const AppContext = createContext(null);

const EMPTY_SELECTIONS = { style: null, mood: null, color: null, background: null };

export function AppProvider({ children }) {
  // --- Customer journey state ---
  const [view, setView] = useState('customer'); // 'customer' | 'ops'
  const [opsTab, setOpsTab] = useState('review'); // 'review' | 'architecture'
  const [step, setStep] = useState(1);
  const [source, setSource] = useState(null); // 'upload' | 'generate'
  const [uploaded, setUploaded] = useState(null); // { name, size, dataURL }
  const [uploadMeta, setUploadMeta] = useState(null); // { tone, html }
  const [selections, setSelections] = useState(EMPTY_SELECTIONS);
  const [freeText, setFreeText] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [cardOrientation, setCardOrientation] = useState('horizontal');

  // Pipeline + AI generation state
  const [layerStatus, setLayerStatus] = useState({}); // { L0: 'pending'|'running'|... }
  const [signals, setSignals] = useState(null);
  const [decision, setDecision] = useState(null);
  const [variations, setVariations] = useState([]); // [{ src, cache: {horizontal,vertical}, failed?, error? }]
  const [selectedVariation, setSelectedVariation] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingText, setAiLoadingText] = useState('');
  const [errorBanner, setErrorBanner] = useState('');
  // Every dispatched generation counts as one iteration — the initial run, each
  // "Try again", and each orientation re-render. Tracked per orientation because
  // switching horizontal/vertical triggers a real provider call, and ops needs to
  // see that effort. The old `regenCount` started at 0 on the first generation
  // and never counted orientation re-renders at all.
  const [iterations, setIterations] = useState({ total: 0, horizontal: 0, vertical: 0 });
  const recordIteration = useCallback((orientation) => {
    const orient = orientation === 'vertical' ? 'vertical' : 'horizontal';
    setIterations((cur) => ({
      total: cur.total + 1,
      horizontal: cur.horizontal + (orient === 'horizontal' ? 1 : 0),
      vertical: cur.vertical + (orient === 'vertical' ? 1 : 0),
    }));
  }, []);
  const [lastPrompt, setLastPrompt] = useState('');
  const hasGeneratedRef = useRef(false);
  const seedRef = useRef(null);

  // Signed verdict from /api/generate. Required to submit — the server will not
  // take the browser's word on a moderation decision.
  const [verdictToken, setVerdictToken] = useState(null);

  // --- Ops state (server-backed) ---
  const [opsQueue, setOpsQueue] = useState([]);
  const [opsHistory, setOpsHistory] = useState({ approved: [], rejected: [] });
  const [opsLoading, setOpsLoading] = useState(true);
  const [opsError, setOpsError] = useState(null);
  const [opsStorage, setOpsStorage] = useState(null); // 'kv' | 'memory' | null
  const [opsStats, setOpsStats] = useState(null);

  const refreshQueue = useCallback(async () => {
    setOpsError(null);
    try {
      const data = await fetchQueue();
      setOpsQueue(data.queue || []);
      setOpsHistory(data.history || { approved: [], rejected: [] });
      setOpsStats(data.stats || null);
      setOpsStorage(data.storageOk === false ? 'error' : data.storage);
      if (data.storageOk === false) setOpsError(data.storageNote || 'Queue storage unreachable');
    } catch (err) {
      setOpsError(err.message);
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => { refreshQueue(); }, [refreshQueue]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState('approved');
  const [historyView, setHistoryView] = useState('grid');

  // --- Settings (AI provider) ---
  const [settings, setSettingsState] = useState(loadSettings);
  const updateSettings = useCallback((next) => {
    setSettingsState(next);
    saveSettings(next);
  }, []);

  // --- Modal + Toast ---
  const [modal, setModal] = useState(null); // { title, subtitle, body, actions }
  const [toast, setToast] = useState(null); // { tone, message, id }
  const toastTimerRef = useRef(null);

  const openModal = useCallback((m) => setModal(m), []);
  const closeModal = useCallback(() => setModal(null), []);

  const showToast = useCallback((tone, message, duration = 3200) => {
    clearTimeout(toastTimerRef.current);
    const id = Date.now() + Math.random();
    setToast({ tone, message, id });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const resetCustomer = useCallback(() => {
    setStep(1);
    setSource(null);
    setUploaded(null);
    setUploadMeta(null);
    setSelections(EMPTY_SELECTIONS);
    setFreeText('');
    setSignals(null);
    setDecision(null);
    setVariations([]);
    setSelectedVariation(0);
    setAiLoading(false);
    setAiLoadingText('');
    setErrorBanner('');
    setIterations({ total: 0, horizontal: 0, vertical: 0 });
    setLastPrompt('');
    setVerdictToken(null);
    setCardholderName('');
    setLayerStatus({});
    hasGeneratedRef.current = false;
    seedRef.current = null;
  }, []);

  const value = {
    // nav
    view, setView,
    opsTab, setOpsTab,
    step, setStep,
    // step 1
    source, setSource,
    uploaded, setUploaded,
    uploadMeta, setUploadMeta,
    // step 2
    selections, setSelections,
    freeText, setFreeText,
    // preview
    cardholderName, setCardholderName,
    cardOrientation, setCardOrientation,
    // pipeline + generation
    layerStatus, setLayerStatus,
    signals, setSignals,
    decision, setDecision,
    variations, setVariations,
    selectedVariation, setSelectedVariation,
    aiLoading, setAiLoading,
    aiLoadingText, setAiLoadingText,
    errorBanner, setErrorBanner,
    iterations, recordIteration,
    lastPrompt, setLastPrompt,
    hasGeneratedRef, seedRef,
    resetCustomer,
    verdictToken, setVerdictToken,
    // ops
    opsQueue, setOpsQueue,
    opsHistory, setOpsHistory,
    opsLoading, opsError, opsStorage, opsStats, refreshQueue,
    historyOpen, setHistoryOpen,
    historyTab, setHistoryTab,
    historyView, setHistoryView,
    // settings
    settings, updateSettings,
    // modal + toast
    modal, openModal, closeModal,
    toast, showToast,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
