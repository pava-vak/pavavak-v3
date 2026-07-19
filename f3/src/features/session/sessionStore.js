import { devLogin, fetchMe, getCachedUser, login, logout, refreshSession, register, setUnauthorizedHandler } from '../../shared/apiClient.js';
import { disconnectSocket, connectSocket } from '../../shared/socketClient.js';
import { readTokens } from '../../shared/tokenStore.js';

export function createSessionStore() {
  const hasToken = Boolean(readTokens().accessToken);
  let state = {
    status: hasToken ? 'loading' : 'idle',
    user: getCachedUser(),
    error: '',
    tokensPresent: hasToken
  };

  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function setState(patch) {
    state = {
      ...state,
      ...patch
    };
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
    } catch (error) {
      if (error.status === 401 && readTokens().refreshToken) {
        try {
          await refreshSession();
          const me = await fetchMe();
          connectSocket();
          setState({
            status: 'authenticated',
            user: me.user,
            error: ''
          });
          return;
        } catch {
          logout();
        }
      }

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
    setState({
      status: 'loading',
      error: ''
    });

    try {
      const result = await login(input);
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

  async function registerAccount(input) {
    setState({
      status: 'loading',
      error: ''
    });

    try {
      const result = await register(input);
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
        error: error.message || 'Registration failed',
        tokensPresent: false
      });
    }
  }

  function signOut() {
    logout();
    disconnectSocket();
    setState({
      status: 'signed_out',
      user: null,
      error: '',
      tokensPresent: false
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
    bootstrap,
    loginWithPassword,
    registerAccount,
    loginAsDev,
    signOut
  };
}
