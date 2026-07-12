import { useEffect } from 'react';
import { useNoteStore } from '../store/noteStore';

export function useFileWatcher(intervalMs = 2000) {
  const checkFileChanges = useNoteStore(s => s.checkFileChanges);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let id: ReturnType<typeof setInterval> | undefined;

    function start() {
      stop();
      if (!document.hidden) {
        checkFileChanges();
        id = setInterval(() => checkFileChanges(), intervalMs);
      }
    }

    function stop() {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    }

    document.addEventListener('visibilitychange', start);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', start);
    };
  }, [checkFileChanges, intervalMs]);
}
