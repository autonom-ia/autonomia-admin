export type AdminStatus = "active" | "inactive";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: AdminStatus | "invited";
  roleNames?: string[];
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

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  status: AdminStatus;
}

export interface AdminMe {
  user: AdminUser;
  organizations: Array<{ id: string; name: string }>;
  permissions: string[];
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
