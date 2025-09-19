import {BasicAuth, OAuth2Auth} from '../../src';

describe('Auth Classes', () => {
  describe('BasicAuth', () => {
    test('should create BasicAuth with username only', () => {
      const auth = new BasicAuth('testuser');
      expect(auth.username).toBe('testuser');
      expect(auth.password).toBeUndefined();
      expect(auth.type).toBe('basic');
    });

    test('should create BasicAuth with username and password', () => {
      const auth = new BasicAuth('testuser', 'testpass');
      expect(auth.username).toBe('testuser');
      expect(auth.password).toBe('testpass');
      expect(auth.type).toBe('basic');
    });
  });

  describe('OAuth2Auth', () => {
    test('should create OAuth2Auth with token only', () => {
      const auth = new OAuth2Auth('test-token');
      expect(auth.token).toBe('test-token');
      expect(auth.type).toBe('oauth2');
      expect(auth.clientId).toBeUndefined();
      expect(auth.clientSecret).toBeUndefined();
      expect(auth.refreshToken).toBeUndefined();
      expect(auth.tokenEndpoint).toBeUndefined();
      expect(auth.scopes).toBeUndefined();
      expect(auth.tokenType).toBeUndefined();
      expect(auth.expiresIn).toBeUndefined();
      expect(auth.redirectUri).toBeUndefined();
      expect(auth.grantType).toBeUndefined();
    });

    test('should create OAuth2Auth with all optional parameters', () => {
      const auth = new OAuth2Auth(
        'test-token',
        'client-id',
        'client-secret',
        'refresh-token',
        'https://example.com/oauth2/token',
        ['read', 'write'],
        'Bearer',
        3600,
        'https://example.com/callback',
        'authorization_code'
      );

      expect(auth.token).toBe('test-token');
      expect(auth.clientId).toBe('client-id');
      expect(auth.clientSecret).toBe('client-secret');
      expect(auth.refreshToken).toBe('refresh-token');
      expect(auth.tokenEndpoint).toBe('https://example.com/oauth2/token');
      expect(auth.scopes).toEqual(['read', 'write']);
      expect(auth.tokenType).toBe('Bearer');
      expect(auth.expiresIn).toBe(3600);
      expect(auth.redirectUri).toBe('https://example.com/callback');
      expect(auth.grantType).toBe('authorization_code');
      expect(auth.type).toBe('oauth2');
    });

    test('should create OAuth2Auth with some optional parameters', () => {
      const auth = new OAuth2Auth(
        'test-token',
        'client-id',
        undefined,
        'refresh-token',
        undefined,
        ['read']
      );

      expect(auth.token).toBe('test-token');
      expect(auth.clientId).toBe('client-id');
      expect(auth.clientSecret).toBeUndefined();
      expect(auth.refreshToken).toBe('refresh-token');
      expect(auth.tokenEndpoint).toBeUndefined();
      expect(auth.scopes).toEqual(['read']);
    });
  });
});