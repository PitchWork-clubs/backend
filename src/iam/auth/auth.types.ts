export type TPayload = {
  sub: string;
  person_id: string;
  sid?: string;
};

export type TRegistrationResult = {
  user_id: string;
  person_id: string;
  name: string;
  isEmailVerified: boolean;
  verificationRequired: boolean;
  verificationChannel: 'email' | 'phone';
};

export type TCurrentUser = {
  user_id: string;
  person_id: string;
};

export type TUserData = {
  user_id: string;
  person_id: string;
  email: string;
  name: string;
  isEmailVerified: boolean;
};
