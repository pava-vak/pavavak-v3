import { searchUsers, startDirectChat } from '../../shared/apiClient.js';

export function createPeopleStore() {
  let state = {
    status: 'idle',
    items: [],
    error: '',
    query: ''
  };

  const listeners = new Set();

  function emit() {
    for (const listener of listeners) listener(state);
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  async function search(query = '') {
    setState({ status: 'loading', error: '', query });
    try {
      const result = await searchUsers(query);
      setState({ status: 'ready', items: result.items || [], error: '', query });
    } catch (error) {
      setState({ status: 'error', items: [], error: error.message || 'Failed to search users', query });
    }
  }

  async function startChat(userId) {
    const result = await startDirectChat(userId);
    return result.chat;
  }

  function reset() {
    setState({ status: 'idle', items: [], error: '', query: '' });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    search,
    startChat,
    reset,
    getState() {
      return state;
    }
  };
}
