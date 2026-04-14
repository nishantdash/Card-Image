import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { INITIAL_OPS_QUEUE } from '../lib/opsMocks.js';

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
  const [regenCount, setRegenCount] = useState(0);
  const [lastPrompt, setLastPrompt] = useState('');
  const hasGeneratedRef = useRef(false);
  const seedRef = useRef(null);

  // --- Ops state ---
  const [opsQueue, setOpsQueue] = useState(INITIAL_OPS_QUEUE);
  const [opsHistory, setOpsHistory] = useState({ approved: [], rejected: [] });
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
    setRegenCount(0);
    setLastPrompt('');
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
    regenCount, setRegenCount,
    lastPrompt, setLastPrompt,
    hasGeneratedRef, seedRef,
    resetCustomer,
    // ops
    opsQueue, setOpsQueue,
    opsHistory, setOpsHistory,
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
