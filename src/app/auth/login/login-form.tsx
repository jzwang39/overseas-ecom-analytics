"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => searchParams.get("callbackUrl") ?? "/work", [searchParams]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });

    setSubmitting(false);

    if (!result || result.error) {
      setError("用户名或密码错误，或账号已被禁用");
      return;
    }

    router.replace(result.url ?? callbackUrl);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm text-muted">用户名</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          autoComplete="username"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm text-muted">密码</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {error ? <div className="text-sm text-danger">{error}</div> : null}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium hover:bg-primary-2 disabled:opacity-50"
      >
        {submitting ? "登录中…" : "登录"}
      </button>
    </form>
  );
}

