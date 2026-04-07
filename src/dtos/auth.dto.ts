export interface LoginDTO {
  email: string;
  password: string;
}

export interface RegisterDTO {
  name: string;
  email: string;
  password: string;
  businessName: string;  // Nome do restaurante
  businessSlug: string;  // Slug único (ex: 'burger-joao', 'cantina-napoli')
}
