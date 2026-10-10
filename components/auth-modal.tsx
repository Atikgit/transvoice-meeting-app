"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { X, Loader2 } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const supabase = createClient();

  // ইমেইল এবং পাসওয়ার্ড দিয়ে সাবমিট
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      if (isSignUp) {
        // ১. নতুন অ্যাকাউন্ট তৈরি (স্বয়ংক্রিয়ভাবে ১৫ মিনিট ফ্রি ব্যালেন্স পাবে)
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });

        if (error) throw error;
        alert("Account created successfully! You received 15 minutes of free translation.");
      } else {
        // ২. লগইন করা
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
      }

      if (onSuccess) onSuccess();
      onClose();
      window.location.reload(); // পেজ রিফ্রেশ করে সেশন আপডেট
    } catch (err: any) {
      setErrorMsg(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  // গুগল দিয়ে সাইন-ইন
  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0d131f] p-6 shadow-2xl text-white">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-white transition"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <h2 className="text-xl font-semibold mb-6">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h2>

        {/* Tabs: Sign in / Create account */}
        <div className="grid grid-cols-2 p-1 bg-white/5 rounded-xl mb-6">
          <button
            type="button"
            onClick={() => { setIsSignUp(false); setErrorMsg(""); }}
            className={`py-2 text-sm font-medium rounded-lg transition ${
              !isSignUp ? "bg-white/15 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setIsSignUp(true); setErrorMsg(""); }}
            className={`py-2 text-sm font-medium rounded-lg transition ${
              isSignUp ? "bg-white/15 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            Create account
          </button>
        </div>

        {/* Social Buttons */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm font-medium"
          >
            <span className="text-red-400 font-bold">G</span> Google
          </button>
          <button
            type="button"
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm font-medium opacity-60 cursor-not-allowed"
          >
            <span className="text-blue-400 font-bold">M</span> Microsoft
          </button>
        </div>

        <div className="relative flex items-center justify-center mb-6">
          <div className="w-full border-t border-white/10"></div>
          <span className="absolute bg-[#0d131f] px-3 text-xs uppercase tracking-wider text-gray-400">
            Or continue with email
          </span>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div>
              <input
                type="text"
                required
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-cyan-400 focus:outline-none transition"
              />
            </div>
          )}

          <div>
            <input
              type="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-cyan-400 focus:outline-none transition"
            />
          </div>

          <div>
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-cyan-400 focus:outline-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center py-3 px-4 rounded-xl bg-cyan-400 text-gray-950 font-semibold hover:bg-cyan-300 transition text-sm disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isSignUp ? (
              "Create free account"
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        {/* Free trial footer notice */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 py-2.5 rounded-xl">
          <span>⚡</span>
          <span>Includes 15 minutes of free real-time AI translation</span>
        </div>
      </div>
    </div>
  );
}