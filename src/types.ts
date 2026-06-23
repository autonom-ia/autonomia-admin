export type AdminStatus = "active" | "inactive";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  photoUrl?: string | null;
  status: AdminStatus | "invited";
  profileId?: string | null;
  profileKey?: string | null;
  profileName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProfile {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrganization {
  id: string;
  key: string;
  name: string;
  status: AdminStatus;
  role?: string | undefined;
  isPrimary?: boolean | undefined;
  membershipStatus?: AdminStatus | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProduct {
  id: string;
  key: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  registerCallbackUrl: string | null;
  termsUrl: string | null;
  oauthClientId: string | null;
  allowedRedirectUris: string[];
  allowedLogoutUris: string[];
  allowedOrigins: string[];
  allowGoogleLogin: boolean;
  allowGithubLogin: boolean;
  allowEmailPasswordLogin: boolean;
  allowPasskeyLogin: boolean;
  allowBackgroundAuth: boolean;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authSyncStatus: "pending" | "synced" | "failed";
  authSyncError: string | null;
  authSyncedAt: string | null;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductCustomization {
  id: string;
  productId: string;
  domain: string;
  displayName: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  themeTokens: Record<string, unknown>;
  customCss: Record<string, unknown>;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminService {
  id: string;
  key: string;
  name: string;
  description: string | null;
  serviceType: "sdk" | "api" | "worker" | "integration";
  packageName: string | null;
  entrypointUrl: string | null;
  status: AdminStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductService {
  id: string;
  productId: string;
  serviceId: string;
  status: "enabled" | "disabled";
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  status: AdminStatus;
}

export interface AdminMe {
  user: AdminUser;
  organizations: AdminOrganization[];
  permissions: string[];
  profiles: AdminProfile[];
  services: AdminService[];
  products: AdminProduct[];
}

export interface AuthenticatedPrincipal {
  id: string;
  email: string;
  name: string;
  tokenUse?: string | undefined;
  rawClaims: Record<string, unknown>;
}
