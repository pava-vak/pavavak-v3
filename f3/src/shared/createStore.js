export function createStore(getState) {
  const listeners = new Set();
  return {
    emit() { for (const l of listeners) l(getState()); },
    subscribe(listener) {
      listeners.add(listener);
      listener(getState());
      return () => listeners.delete(listener);
    }
  };
}
