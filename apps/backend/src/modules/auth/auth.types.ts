import type { User } from "@prisma/client";

export type SafeUser = Omit<User, "passwordHash" | "resetToken" | "resetTokenExpiresAt">;

export type AuthResponse = {
  user: SafeUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
  session: {
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  };
};

export type AuthResult = {
  data: AuthResponse;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};
