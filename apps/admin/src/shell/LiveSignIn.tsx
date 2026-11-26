import { useState, type FormEvent } from 'react';
import { useSession } from '@/data/session';
import { LIVE, signInWithPassword, verifyCode, type SignInStep } from '@/data/live';
import { Field } from '@/ui/kit';

/**
 * Real staff sign-in (D-081): email and password, then a 6-digit code from an authenticator app.
 * The first time, the staff member scans a QR code to set the app up. Staff permissions come from the API.
 */
export function LiveSignIn() {
  const { setLiveStaff } = useSession();
  const [step, setStep] = useState<SignInStep>({ step: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!LIVE) return null;
  const live = LIVE;

  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = step.step === 'password' ? await signInWithPassword(live, email, password) : step.step === 'code' || step.step === 'enrol' ? await verifyCode(live, step.factorId, code) : null;
    setBusy(false);
    if (!r) return;
    if (!r.ok) return setError(r.error);
    setCode('');
    if (r.value.step === 'done') setLiveStaff(r.value.staff);
    else setStep(r.value);
  };

  return (
    <form onSubmit={go} className="stack" style={{ display: 'grid', gap: 14 }} aria-describedby={error ? 'signin-error' : undefined}>
      {step.step === 'password' ? (
        <>
          <Field label="Work email">{(id) => <input id={id} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
          <Field label="Password">{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        </>
      ) : (
        <>
          {step.step === 'enrol' ? (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
              <p className="muted">Set up two-step sign-in: scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the code it shows.</p>
              <img src={step.qr} alt="QR code for your authenticator app" width={168} height={168} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
              <span className="small muted">
                Can’t scan? Enter this key: <code>{step.secret}</code>
              </span>
            </div>
          ) : (
            <p className="muted">Enter the 6-digit code from your authenticator app.</p>
          )}
          <Field label="Code">
            {(id) => <input id={id} className="input num" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />}
          </Field>
        </>
      )}
      {error ? (
        <p id="signin-error" className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Checking…' : step.step === 'password' ? 'Continue' : 'Sign in'}
      </button>
    </form>
  );
}
