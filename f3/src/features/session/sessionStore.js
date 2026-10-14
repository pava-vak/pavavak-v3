import { devLogin, fetchMe, getCachedUser, login, logout, register, setUnauthorizedHandler, updateProfile } from '../../shared/apiClient.js';
import { disconnectSocket, connectSocket } from '../../shared/socketClient.js';
import { readTokens } from '../../shared/tokenStore.js';
import { createStore } from '../../shared/createStore.js';

export function createSessionStore() {
  const hasToken = Boolean(readTokens().accessToken);
  let state = {
    status: hasToken ? 'loading' : 'idle',
    user: getCachedUser(),
    error: '',
    tokensPresent: hasToken,
    loginLoading: false,
    registerLoading: false
  };

  const { emit, subscribe } = createStore(() => state);

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  setUnauthorizedHandler(() => {
    disconnectSocket();
    setState({
      status: 'signed_out',
      user: null,
      error: '',
      tokensPresent: false
    });
  });

  async function bootstrap() {
    if (!readTokens().accessToken) {
      setState({
        status: 'signed_out',
        user: null,
        error: '',
        tokensPresent: false
      });
      return;
    }

    setState({
      status: 'loading',
      error: '',
      tokensPresent: true,
      user: getCachedUser()
    });

    try {
      const me = await fetchMe();
      connectSocket();
      setState({
        status: 'authenticated',
        user: me.user,
        error: ''
      });
    } catch {
      // apiClient handles 401 → refresh → retry transparently before throwing
      disconnectSocket();
      setState({
        status: 'signed_out',
        user: null,
        error: '',
        tokensPresent: false
      });
    }
  }

  async function loginAsDev(input) {
    setState({
      status: 'loading',
      error: ''
    });

    try {
      const result = await devLogin(input);
      connectSocket();
      setState({
        status: 'authenticated',
        user: result.user,
        error: '',
        tokensPresent: true
      });
    } catch (error) {
      setState({
        status: 'signed_out',
        user: null,
        error: error.message || 'Login failed',
        tokensPresent: false
      });
    }
  }

  async function loginWithPassword(input) {
    setState({ loginLoading: true, error: '' });

    try {
      const result = await login(input);
      connectSocket();
      setState({
        status: 'authenticated',
        user: result.user,
        error: '',
        tokensPresent: true,
        loginLoading: false
      });
    } catch (error) {
      setState({
        status: 'signed_out',
        user: null,
        error: error.message || 'Login failed',
        tokensPresent: false,
        loginLoading: false
      });
    }
  }

  async function registerAccount(input) {
    setState({ registerLoading: true, error: '' });

    try {
      const result = await register(input);
      connectSocket();
      setState({
        status: 'authenticated',
        user: result.user,
        error: '',
        tokensPresent: true,
        registerLoading: false
      });
    } catch (error) {
      setState({
        status: 'signed_out',
        user: null,
        error: error.message || 'Registration failed',
        tokensPresent: false,
        registerLoading: false
      });
    }
  }

  async function updateDisplayName(displayName) {
    const result = await updateProfile({ displayName });
    setState({ user: { ...state.user, displayName: result.user.displayName } });
    return result.user;
  }

  async function signOut() {
    await logout();
    disconnectSocket();
    setState({
      status: 'signed_out',
      user: null,
      error: '',
      tokensPresent: false
    });
  }

  return {
    subscribe,
    getState() {
      return state;
    },
    bootstrap,
    loginWithPassword,
    registerAccount,
    loginAsDev,
    signOut,
    updateDisplayName
  };
}
