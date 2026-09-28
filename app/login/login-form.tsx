"use client";

import { LoaderCircle, Lock } from "lucide-react";
import { BrandMark } from "@/components/dashboard/sidebar";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { safeNextPath } from "@/lib/auth";
import { errorText, post } from "@/lib/client/api";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await post("/login", { password });
      const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      window.location.assign(next);
    } catch (err) {
      setError(errorText(err));
      setSubmitting(false);
    }
  }

  return (
    <Card className="relative w-full max-w-sm shadow-xl shadow-black/5">
      <CardHeader className="items-center p-8 pb-0 text-center">
        <BrandMark className="mx-auto mb-3 size-11 rounded-2xl" />
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Enter the team password to open Lead Finder.</CardDescription>
      </CardHeader>
      <CardContent className="p-8">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting || !password}>
            {submitting ? <LoaderCircle className="animate-spin" /> : <Lock />} Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
