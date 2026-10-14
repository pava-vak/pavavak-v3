import { requestAdminChats, requestAdminSummary, requestAdminUsers, requestAdminResetPassword, requestAdminCreateUser, requestBroadcastUpdate } from '../../shared/apiClient.js';

export function createAdminStore() {
  let state = {
    status: 'idle',
    activeTab: 'dashboard',
    summary: null,
    users: [],
    monitorChats: [],
    monitorStatus: 'idle',
    otpResult: null,
    broadcastStatus: 'idle',
    broadcastCount: 0,
    addUserStatus: 'idle', // 'idle' | 'saving' | 'error'
    addUserError: '',
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

  async function createUser({ username, displayName, password }) {
    setState({ addUserStatus: 'saving', addUserError: '' });
    try {
      const result = await requestAdminCreateUser({ username, displayName, password });
      setState({
        addUserStatus: 'idle',
        users: [...state.users, result.user],
        summary: state.summary ? { ...state.summary, users: state.summary.users + 1 } : state.summary
      });
      return { success: true };
    } catch (error) {
      // Extract Zod field errors when available
      const details = error?.payload?.details?.fieldErrors || {};
      const fieldMsgs = Object.entries(details)
        .map(([field, msgs]) => `${field}: ${msgs[0]}`)
        .join(', ');
      const msg = fieldMsgs || error?.message || 'Failed to create user';
      setState({ addUserStatus: 'error', addUserError: msg });
      return { success: false, error: msg };
    }
  }

  function clearAddUserError() {
    setState({ addUserStatus: 'idle', addUserError: '' });
  }

  async function broadcastUpdate() {
    setState({ broadcastStatus: 'loading' });
    try {
      const result = await requestBroadcastUpdate();
      setState({ broadcastStatus: 'done', broadcastCount: result.count || 0 });
      setTimeout(() => setState({ broadcastStatus: 'idle', broadcastCount: 0 }), 4000);
    } catch (error) {
      setState({ broadcastStatus: 'error', error: error.message || 'Failed to broadcast' });
      setTimeout(() => setState({ broadcastStatus: 'idle' }), 4000);
    }
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
    broadcastUpdate,
    createUser,
    clearAddUserError,
    setTab,
    reset,
    getState() {
      return state;
    }
  };
}
