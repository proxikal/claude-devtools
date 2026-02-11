import { useEffect, useState } from 'react';

/**
 * Reads current zoom factor and stays subscribed to zoom updates from main.
 */
export function useZoomFactor(): number {
  const [zoomFactor, setZoomFactor] = useState(1);

  useEffect(() => {
    let isMounted = true;

    void window.electronAPI
      .getZoomFactor()
      .then((value) => {
        if (isMounted) {
          setZoomFactor(value);
        }
      })
      .catch(() => {
        // Keep default 1 if zoom factor cannot be read.
      });

    const unsubscribe = window.electronAPI.onZoomFactorChanged((value) => {
      setZoomFactor(value);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return zoomFactor;
}
