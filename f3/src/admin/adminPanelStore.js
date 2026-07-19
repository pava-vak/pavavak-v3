import { login, requestAdminSummary, requestAdminUsers, requestAdminChats, requestAdminResetPassword, requestAdminThread } from '../shared/apiClient.js';
import { readTokens, readUser, clearTokens } from '../shared/tokenStore.js';

export function createAdminPanelStore() {
  let state = {
    status: 'checking', // checking | login | loading | ready | denied
    user: null,
    error: '',
    activeTab: 'users',
    summary: null,
    users: [],
    chats: [],
    monitorChat: null,
    monitorMessages: [],
    monitorLoading: false,
    usersLoading: false,
    chatsLoading: false,
    otpResult: null
  };

  const listeners = new Set();

  function emit() {
    for (const l of listeners) l(state);
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  async function bootstrap() {
    const tokens = readTokens();
    const user = readUser();
    if (tokens?.accessToken && user) {
      if (!user.isAdmin) {
        setState({ status: 'denied', user });
        return;
      }
      setState({ status: 'ready', user });
      loadData();
    } else {
      setState({ status: 'login' });
    }
  }

  async function adminLogin(credentials) {
    setState({ status: 'loading', error: '' });
    try {
      const result = await login(credentials);
      if (!result.user?.isAdmin) {
        clearTokens();
        setState({ status: 'login', error: 'Admin access only. Your account does not have admin privileges.' });
        return;
      }
      setState({ status: 'ready', user: result.user, error: '' });
      loadData();
    } catch (err) {
      setState({ status: 'login', error: err.message || 'Login failed.' });
    }
  }

  async function loadData() {
    setState({ usersLoading: true });
    try {
      const [summary, users] = await Promise.all([
        requestAdminSummary(),
        requestAdminUsers()
      ]);
      setState({ summary: summary.summary, users: users.items || [], usersLoading: false });
    } catch (err) {
      setState({ usersLoading: false, error: err.message });
    }
  }

  async function loadChats() {
    setState({ chatsLoading: true });
    try {
      const result = await requestAdminChats();
      setState({ chats: result.items || [], chatsLoading: false });
    } catch (err) {
      setState({ chatsLoading: false });
    }
  }

  async function openMonitorChat(chat) {
    setState({ monitorChat: chat, monitorMessages: [], monitorLoading: true });
    try {
      const result = await requestAdminThread(chat.chatId);
      setState({ monitorMessages: result.messages || [], monitorLoading: false });
    } catch {
      setState({ monitorLoading: false });
    }
  }

  function closeMonitorChat() {
    setState({ monitorChat: null, monitorMessages: [] });
  }

  async function resetPassword(userId) {
    setState({ otpResult: null });
    try {
      const result = await requestAdminResetPassword(userId);
      setState({ otpResult: { userId, password: result.temporaryPassword } });
    } catch (err) {
      setState({ error: err.message });
    }
  }

  function clearOtp() {
    setState({ otpResult: null });
  }

  function setTab(tab) {
    setState({ activeTab: tab, monitorChat: null, monitorMessages: [] });
    if (tab === 'monitor' && state.chats.length === 0) loadChats();
  }

  function signOut() {
    clearTokens();
    setState({
      status: 'login', user: null, error: '',
      summary: null, users: [], chats: [],
      monitorChat: null, monitorMessages: [], otpResult: null
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    bootstrap,
    adminLogin,
    loadData,
    loadChats,
    openMonitorChat,
    closeMonitorChat,
    resetPassword,
    clearOtp,
    setTab,
    signOut,
    getState() { return state; }
  };
}
