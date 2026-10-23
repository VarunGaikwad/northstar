// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AuthScreen } from "./AuthScreen";

vi.mock("./useAuth", () => ({
  useAuth: () => ({ setSession: vi.fn(), expired: false, clearExpired: vi.fn() }),
}));
vi.mock("../api/endpoints/auth", () => ({
  useLogin: () => ({ isPending: false }),
  useRegister: () => ({ isPending: false }),
  useForgotPassword: () => ({ isPending: false }),
  useResetPassword: () => ({ isPending: false }),
}));

it("identifies login credentials for browser and password-manager autofill", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<AuthScreen />);

  const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
  const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(email.name).toBe("email");
  expect(email.autocomplete).toBe("username");
  expect(password.name).toBe("password");
  expect(password.autocomplete).toBe("current-password");
});
