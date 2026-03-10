export interface LoginDTO {
  email: string;
  password: string;
}

export interface RegisterDTO {
  name: string;
  email: string;
  password: string;
  tenantName: string;  // Nome da pizzaria
  tenantSlug: string;  // Slug único (ex: 'larissa', 'dom-pedro')
}
