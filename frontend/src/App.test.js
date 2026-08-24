import { render, screen } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
});

test("shows the sign-in screen when no session exists", () => {
  render(<App />);

  expect(screen.getByText("Chatters")).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/نام کاربری یا ایمیل/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /ورود/ })).toBeInTheDocument();
});

test("does not offer self-service signup while registration is closed", () => {
  render(<App />);

  expect(
    screen.queryByRole("button", { name: /ساخت حساب جدید/ })
  ).not.toBeInTheDocument();
});
