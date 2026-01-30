
export type Role = 'user' | 'model' | 'function';
export type Gender = 'male' | 'female';

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
  gender: Gender;
  age: number;
  googleId?: string;
  emotionalMemory?: string; // Stores AI's long-term observations
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
  sources?: { title: string; uri: string }[];
  imageUrl?: string;
  imagePart?: { data: string; mimeType: string };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}
