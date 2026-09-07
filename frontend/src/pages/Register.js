import { useState } from "react";
import { register } from "../api/auth";

/**
 * Signup form. Submitting does not create an account — it files a request for
 * an administrator to approve — so the success state is a "waiting for review"
 * screen rather than a "you're in" one. Saying otherwise would send people
 * straight to a sign-in page that cannot work yet.
 */
export default function Register({ onRegister, onBack }) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleRegister(e) {
    e?.preventDefault();

    if (!form.username || !form.email || !form.password) {
      setError("لطفاً نام کاربری، ایمیل و رمز عبور را وارد کنید");
      return;
    }
    if (form.password.length < 8) {
      setError("رمز عبور باید حداقل ۸ کاراکتر باشد");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await register(form.username, form.email, form.password, form.phone);
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "ثبت درخواست ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.card} className="card stack">
          <div style={styles.bigIcon}>⏳</div>
          <h2 style={styles.title}>درخواست شما ثبت شد</h2>
          <p style={styles.body}>
            حساب شما با نام کاربری <strong>{form.username}</strong> ساخته
            <em> نشده</em> است و در انتظار تأیید مدیر قرار دارد. پس از تأیید،
            می‌توانید با همین نام کاربری و رمز عبور وارد شوید.
          </p>
          <p className="muted" style={{ textAlign: "center", lineHeight: 1.8 }}>
            تا زمان تأیید، ورود امکان‌پذیر نیست. لطفاً بعداً دوباره تلاش کنید.
          </p>
          <button className="btn btn-block" onClick={onRegister}>
            بازگشت به صفحه ورود
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} className="card stack" onSubmit={handleRegister}>
        <h2 style={styles.title}>ساخت حساب کاربری</h2>

        <p className="muted" style={{ textAlign: "center", lineHeight: 1.8, margin: 0 }}>
          ثبت‌نام نیازمند تأیید مدیر است. پس از ارسال، درخواست شما بررسی می‌شود.
        </p>

        <input
          className="field"
          placeholder="نام کاربری (حساس به حروف کوچک و بزرگ)"
          autoComplete="username"
          autoCapitalize="none"
          value={form.username}
          onChange={update("username")}
        />

        <input
          className="field"
          type="email"
          placeholder="ایمیل"
          autoComplete="email"
          autoCapitalize="none"
          dir="ltr"
          value={form.email}
          onChange={update("email")}
        />

        <input
          className="field"
          type="tel"
          placeholder="شماره تلفن (اختیاری)"
          autoComplete="tel"
          dir="ltr"
          value={form.phone}
          onChange={update("phone")}
        />

        <input
          className="field"
          type="password"
          placeholder="رمز عبور (حداقل ۸ کاراکتر)"
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
        />

        <div className="muted" style={{ textAlign: "center", lineHeight: 1.8 }}>
          نام کاربری ۳ تا ۳۲ کاراکتر: حروف انگلیسی، عدد، نقطه، زیرخط یا خط تیره.
          <br />
          اگر نام کاربری گرفته شده بود، عدد اضافه کنید — مثلاً{" "}
          <strong dir="ltr">ali9x3f</strong>
          <br />
          شماره تلفن اختیاری است و پس از تأیید مدیر فعال می‌شود.
        </div>

        {error && (
          <div className="error-text" style={{ textAlign: "center" }}>
            {error}
          </div>
        )}

        <button className="btn btn-block" type="submit" disabled={loading}>
          {loading ? "در حال ارسال…" : "ارسال درخواست ثبت‌نام"}
        </button>

        {onBack && (
          <button type="button" className="btn btn-secondary btn-block" onClick={onBack}>
            بازگشت به ورود
          </button>
        )}
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    paddingTop: "calc(16px + var(--safe-top))",
    paddingBottom: "calc(16px + var(--safe-bottom))",
  },
  card: { width: "100%", maxWidth: 380 },
  title: { margin: 0, textAlign: "center" },
  bigIcon: { fontSize: 48, textAlign: "center" },
  body: { textAlign: "center", lineHeight: 2, margin: 0 },
};
