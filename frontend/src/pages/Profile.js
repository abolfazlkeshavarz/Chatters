import { useCallback, useEffect, useRef, useState } from "react";
import { logout, getMe } from "../api/auth";
import { api } from "../api/client";
import { deleteAvatar, setAvatarVisibility, uploadAvatar } from "../api/avatar";
import { cancelPhoneRequest, removeMyPhone, requestPhone } from "../api/phone";
import Avatar from "../components/Avatar";
import {
  disablePush,
  enablePush,
  isSubscribed,
  isStandalone,
  permission,
  pushSupport,
} from "../api/push";
import { loadIdentity } from "../crypto/keystore";
import { generateIdentity, wrapIdentity, isSupported } from "../crypto/e2ee";

function Section({ title, children }) {
  return (
    <div className="card stack">
      <div className="muted">{title}</div>
      {children}
    </div>
  );
}

export default function Profile({ onLogout }) {
  const username = localStorage.getItem("username");

  const [newUsername, setNewUsername] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [hasKey, setHasKey] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarVisibility, setVisibility] = useState("public");
  const [avatarBusy, setAvatarBusy] = useState(false);
  // Bumped after every upload/delete so <Avatar> (keyed on this) remounts and
  // refetches instead of showing the photo it already cached in this tab.
  const [avatarRefresh, setAvatarRefresh] = useState(0);
  const fileInputRef = useRef(null);

  const [phone, setPhone] = useState(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [pendingPhone, setPendingPhone] = useState(null);
  const [newPhone, setNewPhone] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);

  const support = pushSupport();

  const refreshMe = useCallback(() => {
    return getMe()
      .then((me) => {
        setHasAvatar(Boolean(me.has_avatar));
        setVisibility(me.avatar_visibility || "public");
        setPhone(me.phone || null);
        setPhoneVerified(Boolean(me.phone_verified));
        setPendingPhone(me.pending_phone || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadIdentity(username).then((id) => setHasKey(Boolean(id)));
    isSubscribed().then(setPushOn);
    refreshMe();
  }, [username, refreshMe]);

  async function handleRequestPhone() {
    const value = newPhone.trim();
    if (!value) {
      setError("شماره تلفن را وارد کنید");
      return;
    }
    setPhoneBusy(true);
    setError("");
    try {
      await requestPhone(value);
      setNewPhone("");
      await refreshMe();
      reset("درخواست شما ثبت شد و در انتظار تأیید مدیر است");
    } catch (err) {
      setError(err.message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function handleCancelPhone() {
    setPhoneBusy(true);
    setError("");
    try {
      await cancelPhoneRequest();
      await refreshMe();
      reset("درخواست لغو شد");
    } catch (err) {
      setError(err.message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function handleRemovePhone() {
    if (!window.confirm("شماره تلفن شما حذف شود؟")) return;
    setPhoneBusy(true);
    setError("");
    try {
      await removeMyPhone();
      await refreshMe();
      reset("شماره تلفن حذف شد");
    } catch (err) {
      setError(err.message);
    } finally {
      setPhoneBusy(false);
    }
  }

  function reset(msg) {
    setMessage(msg);
    setError("");
  }

  async function handleLogout() {
    await logout();
    onLogout();
  }

  async function handleChangeUsername() {
    if (!newUsername.trim()) {
      setError("نام کاربری جدید را وارد کنید");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await api.put("/api/profile/username", {
        new_username: newUsername.trim(),
      });
      alert("نام کاربری تغییر کرد. لطفاً دوباره وارد شوید.");
      await logout();
      onLogout();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    if (!oldPassword || !newPassword) {
      setError("هر دو فیلد رمز عبور را پر کنید");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // The identity private key is wrapped with the old password, so it has
      // to be re-wrapped under the new one in the same request or the user
      // loses access to their encrypted chats.
      let keys;
      if (isSupported()) {
        try {
          const stored = await loadIdentity(username);
          if (stored) {
            // The cached key is non-extractable by design, so mint a fresh
            // identity rather than trying to re-wrap the old one. Previously
            // encrypted messages stay readable only on devices still holding
            // the old key, which is why this is called out below.
            keys = await wrapIdentity(await generateIdentity(), newPassword);
          }
        } catch {
          keys = undefined;
        }
      }

      await api.put("/api/profile/password", {
        old_password: oldPassword,
        new_password: newPassword,
        keys,
      });

      alert("رمز عبور تغییر کرد. لطفاً دوباره وارد شوید.");
      await logout();
      onLogout();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the same file again re-fire onChange
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError("تصویر خیلی بزرگ است (حداکثر ۵ مگابایت)");
      return;
    }

    setAvatarBusy(true);
    setError("");
    try {
      await uploadAvatar(file);
      setHasAvatar(true);
      setAvatarRefresh((n) => n + 1);
      reset("عکس پروفایل به‌روزرسانی شد");
    } catch (err) {
      setError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarBusy(true);
    setError("");
    try {
      await deleteAvatar();
      setHasAvatar(false);
      setAvatarRefresh((n) => n + 1);
      reset("عکس پروفایل حذف شد");
    } catch (err) {
      setError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleVisibilityChange(e) {
    const next = e.target.value;
    const prev = avatarVisibility;
    setVisibility(next); // optimistic
    try {
      await setAvatarVisibility(next);
    } catch (err) {
      setVisibility(prev);
      setError(err.message);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setError("");
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        reset("اعلان‌ها خاموش شد");
      } else {
        await enablePush();
        setPushOn(true);
        reset("اعلان‌ها روشن شد");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="container stack">
      <h2 style={{ margin: 0 }}>پروفایل</h2>

      <Section title="نام کاربری">
        <div style={{ fontSize: 16, fontWeight: 500 }}>{username}</div>
      </Section>

      <Section title="📱 شماره تلفن">
        {phone ? (
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <div dir="ltr" style={{ flex: 1, fontSize: 16, fontWeight: 500 }}>
              {phone}
            </div>
            {phoneVerified ? (
              <span className="badge" title="تأیید شده توسط مدیر">
                ✅ تأیید شده
              </span>
            ) : (
              <span className="badge">در انتظار تأیید</span>
            )}
          </div>
        ) : (
          <div className="muted">هنوز شماره‌ای ثبت نکرده‌اید.</div>
        )}

        {pendingPhone ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="muted" style={{ lineHeight: 1.8 }}>
              درخواست شما برای شماره <strong dir="ltr">{pendingPhone}</strong> ثبت
              شده و در انتظار تأیید مدیر است.
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleCancelPhone}
              disabled={phoneBusy}
            >
              لغو درخواست
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <input
              className="field"
              type="tel"
              dir="ltr"
              placeholder={phone ? "شماره جدید" : "مثلاً +989123456789"}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <button className="btn" onClick={handleRequestPhone} disabled={phoneBusy}>
              {phone ? "درخواست تغییر شماره" : "ثبت شماره تلفن"}
            </button>
            {phone && (
              <button
                className="btn btn-secondary"
                onClick={handleRemovePhone}
                disabled={phoneBusy}
              >
                حذف شماره
              </button>
            )}
          </div>
        )}

        <div className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>
          شماره تلفن پس از تأیید مدیر فعال می‌شود. فقط شماره‌های تأیید‌شده در
          «افزودن مخاطب با شماره تلفن» پیدا می‌شوند.
        </div>
      </Section>

      <Section title="📷 عکس پروفایل">
        <div className="row" style={{ alignItems: "center", gap: 14 }}>
          <Avatar key={avatarRefresh} userId={username} size={64} />
          <div className="stack" style={{ gap: 6, flex: 1 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleAvatarFile}
            />
            <button
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
            >
              {avatarBusy ? "…" : hasAvatar ? "تغییر عکس" : "بارگذاری عکس"}
            </button>
            {hasAvatar && (
              <button
                className="btn btn-secondary"
                onClick={handleRemoveAvatar}
                disabled={avatarBusy}
              >
                حذف عکس
              </button>
            )}
          </div>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <div className="muted" style={{ fontSize: 13 }}>چه کسانی می‌توانند ببینند</div>
          <select
            className="field"
            value={avatarVisibility}
            onChange={handleVisibilityChange}
          >
            <option value="public">همه</option>
            <option value="contacts">فقط مخاطبین من</option>
          </select>
          <div className="muted" style={{ fontSize: 12 }}>
            {avatarVisibility === "contacts"
              ? "فقط کسانی که شما آن‌ها را به مخاطبین اضافه کرده‌اید، یا شما را اضافه کرده‌اند، این عکس را می‌بینند — حتی در گروه‌ها."
              : "برای همه کاربران وارد‌شده قابل مشاهده است."}
          </div>
        </div>
      </Section>

      <Section title="🔔 اعلان‌ها">
        {support.supported ? (
          <>
            <button
              className={`btn btn-block ${pushOn ? "btn-secondary" : ""}`}
              onClick={togglePush}
              disabled={pushBusy}
            >
              {pushBusy
                ? "…"
                : pushOn
                ? "خاموش کردن اعلان‌ها"
                : "روشن کردن اعلان‌ها"}
            </button>

            {permission() === "denied" && (
              <div className="muted">
                اعلان‌ها در تنظیمات مرورگر شما برای این سایت مسدود شده است.
                ابتدا باید از همان‌جا اجازه دهید.
              </div>
            )}
          </>
        ) : (
          <div className="muted">{support.reason}</div>
        )}

        {!isStandalone() && (
          <div className="muted">
            نکته: Chatters را به صفحه اصلی گوشی اضافه کنید تا اعلان‌ها مطمئن‌تر
            کار کنند و برنامه تمام‌صفحه باز شود.
          </div>
        )}
      </Section>

      <Section title="🔒 رمزنگاری">
        <div style={{ fontSize: 14 }}>
          {hasKey
            ? "کلید رمزنگاری شما روی این دستگاه باز است. گفتگوهای محرمانه عادی باز می‌شوند."
            : "کلید رمزنگاری روی این دستگاه موجود نیست. خارج شوید و دوباره وارد شوید تا گفتگوهای محرمانه باز شوند."}
        </div>
        <div className="muted">
          گفتگوهای محرمانه در مرورگر شما رمزنگاری می‌شوند. هیچ‌کس دیگری — حتی
          سرور و مدیران — نمی‌تواند آن‌ها را بخواند.
        </div>
      </Section>

      <Section title="تغییر نام کاربری">
        <input
          className="field"
          placeholder="نام کاربری جدید"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
        />
        <button
          className="btn btn-block"
          onClick={handleChangeUsername}
          disabled={loading}
        >
          بروزرسانی نام کاربری
        </button>
      </Section>

      <Section title="تغییر رمز عبور">
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          placeholder="رمز عبور قدیم"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="رمز عبور جدید (حداقل ۸ کاراکتر)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <div className="muted">
          تغییر رمز عبور یک کلید رمزنگاری جدید می‌سازد. پیام‌های گفتگوهای
          محرمانه فعلی فقط روی دستگاه‌هایی خوانا می‌مانند که کلید قدیمی شما
          هنوز آنجا ذخیره است.
        </div>
        <button
          className="btn btn-block"
          onClick={handleChangePassword}
          disabled={loading}
        >
          بروزرسانی رمز عبور
        </button>
      </Section>

      {error && <div className="error-text">{error}</div>}
      {message && <div className="muted">{message}</div>}

      <button className="btn btn-danger btn-block" onClick={handleLogout}>
        خروج
      </button>
    </div>
  );
}
