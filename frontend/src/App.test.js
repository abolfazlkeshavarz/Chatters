import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

test("offers signup, which files a request rather than creating an account", async () => {
  render(<App />);

  const signup = screen.getByRole("button", { name: /ساخت حساب جدید/ });
  expect(signup).toBeInTheDocument();

  await userEvent.click(signup);

  // The distinction that matters: the form must say the account needs approval.
  // If this ever reads like an ordinary signup, people will try to sign in
  // straight afterwards and be told their credentials are wrong.
  expect(screen.getByPlaceholderText(/شماره تلفن/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /ارسال درخواست ثبت‌نام/ })).toBeInTheDocument();
  expect(screen.getByText(/نیازمند تأیید مدیر/)).toBeInTheDocument();
});
