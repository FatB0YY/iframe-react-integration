  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!PARENT_ORIGINS.includes(event.origin)) {
        return;
      }

      const data: TParentToIframeMessage = event.data || {};

      if (data.source !== SOURCE_PARENT) {
        return;
      }

      if (data.type === 'POPUP_CLOSED') {
        tariffContext.clear();
        form.reset();
        setErrorResponse(null);
        setPaymentData(null);
        setStatusOpen(false);
        setStatusState(null);
        setActiveStep(ORDER_STEP.COMPOSITION);

        return;
      }

      if (data.type === 'REQUEST_CLOSE') {
        if (activeStep === ORDER_STEP.PAYMENT_P) {
          setStatusState({
            key: 'card_paid_awaiting',
            email: paymentData?.payerEmail || '',
            onGoHome: () => {
              parentActions.reload({ reason: 'card_paid_awaiting' });
            },
          });
          setStatusOpen(true);
        } else {
          setStatusState({
            key: 'warning_cancel',
            onGoHome: () => {
              parentActions.reload({ reason: 'warning_cancel' });
            },
          });
          setStatusOpen(true);
        }
      }
    };

    window.addEventListener('message', onMessage);

    return () => window.removeEventListener('message', onMessage);
  }, [activeStep, form, paymentData?.payerEmail, tariffContext]);


  export const parentActions = {
  reload(payload?: { reason?: string }) {
    return postToParent({
      type: 'RELOAD_PARENT',
      payload: { ...payload, ts: Date.now() },
    });
  },
};

function getTargetWindow(): Window | null {
  if (typeof window === 'undefined') return null;

  return (window.top && window.top !== window ? window.top : window.parent) || null;
}

export function postToParent(message: Omit<TIframeToParentMessage, 'source'>) {
  const target = getTargetWindow();

  if (!target) return false;

  const fullMessage: TIframeToParentMessage = {
    source: SOURCE_NEXT,
    ...message,
  };

  PARENT_ORIGINS.forEach((origin) => {
    target.postMessage(fullMessage, origin);
  });

  return true;
}

type TParentToIframeType = 'POPUP_CLOSED' | 'REQUEST_CLOSE';

export type TParentToIframeMessage = {
  source: typeof SOURCE_PARENT;
  type: TParentToIframeType;
  payload?: {
    via?: 'close_button' | 'overlay_mousedown' | 'overlay_click' | 'esc' | string;
  };
};

export type TIframeToParentMessage = {
  source: typeof SOURCE_NEXT;
  type: 'RELOAD_PARENT';
  payload?: { reason?: string; ts?: number };
};
