import { requestAdminChats, requestAdminSummary, requestAdminUsers, requestAdminResetPassword } from '../../shared/apiClient.js';

export function createAdminStore() {
  let state = {
    status: 'idle',
    activeTab: 'dashboard',
    summary: null,
    users: [],
    monitorChats: [],
    monitorStatus: 'idle',
    otpResult: null,
    error: ''
  };

  const listeners = new Set();

  function emit() {
    for (const listener of listeners) listener(state);
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  async function load() {
    setState({ status: 'loading', error: '' });
    try {
      const [summary, users] = await Promise.all([
        requestAdminSummary(),
        requestAdminUsers()
      ]);
      setState({
        status: 'ready',
        summary: summary.summary,
        users: users.items || [],
        error: ''
      });
    } catch (error) {
      setState({ status: 'error', error: error.message || 'Failed to load admin dashboard' });
    }
  }

  async function loadMonitorChats() {
    setState({ monitorStatus: 'loading' });
    try {
      const result = await requestAdminChats();
      setState({ monitorChats: result.items || [], monitorStatus: 'ready' });
    } catch (error) {
      setState({ monitorStatus: 'error', error: error.message || 'Failed to load conversations' });
    }
  }

  async function resetPassword(userId) {
    setState({ otpResult: null });
    try {
      const result = await requestAdminResetPassword(userId);
      setState({ otpResult: { userId, password: result.temporaryPassword } });
    } catch (error) {
      setState({ error: error.message || 'Failed to reset password' });
    }
  }

  function clearOtp() {
    setState({ otpResult: null });
  }

  function setTab(tab) {
    setState({ activeTab: tab });
    if (tab === 'monitor' && state.monitorStatus === 'idle') {
      loadMonitorChats();
    }
  }

  function reset() {
    setState({
      status: 'idle',
      activeTab: 'dashboard',
      summary: null,
      users: [],
      monitorChats: [],
      monitorStatus: 'idle',
      otpResult: null,
      error: ''
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    load,
    loadMonitorChats,
    resetPassword,
    clearOtp,
    setTab,
    reset,
    getState() {
      return state;
    }
  };
}
