import React, { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions, authReady } from "../../config/firebase";
import { useWallet } from "../../context/WalletContext";
import { shortenAddress } from "../../utils/formatters";
import { BASE_TOKEN } from "../../services/pool";

// Network fees (same as cloud-functions/config.js)
const COMMENT_FEE = {
  main: "50000000000000000",   // 0.05 KTA (18 decimals)
  test: "1000000",             // testnet fee (9 decimals)
} as const;

const COMMENT_SIGN_PREFIX = "ALPACA_COMMENT_";
const MAX_COMMENT_LENGTH = 500;

interface Comment {
  author: string;
  text: string;
  timestamp: number;
  hash: string;
  replyTo?: string;
}

interface CommentSectionProps {
  poolId: string;
  network: "main" | "test";
}

export const CommentSection: React.FC<CommentSectionProps> = ({ poolId, network }) => {
  const { isConnected, address } = useWallet();

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentAccountAddress, setCommentAccountAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const functionPrefix = network === "test" ? "Test" : "";

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      await authReady;
      const getComments = httpsCallable(functions, `get${functionPrefix}CommentsCall`);
      const result = await getComments({ poolId, limit: 50 });
      const data = result.data as { ok: boolean; comments: Comment[]; commentAccountAddress: string };
      if (data.ok) {
        setComments(data.comments);
        setCommentAccountAddress(data.commentAccountAddress);
      }
    } catch (err) {
      console.error("Failed to fetch comments:", err);
    } finally {
      setLoading(false);
    }
  }, [poolId, functionPrefix]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    if (!isConnected || !address || !text.trim() || !commentAccountAddress) return;
    if (!window.alpaca) {
      setError("Wallet extension not detected");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(false);

    try {
      // 1. Sign ownership message
      const message = COMMENT_SIGN_PREFIX + address;
      const { signature } = await window.alpaca.signMessage(message);

      // 2. Sign fee block (FUND type — builds SEND block without broadcasting)
      const baseToken = BASE_TOKEN[network];
      const feeResult = await window.alpaca.signTransaction({
        type: "FUND",
        to: commentAccountAddress,
        amount: COMMENT_FEE[network],
        token: baseToken.address,
      });

      const feeBlock = typeof feeResult === "string" ? feeResult : feeResult.base64;

      // 3. Submit comment
      await authReady;
      const submitComment = httpsCallable(functions, `submit${functionPrefix}CommentCall`);
      const result = await submitComment({
        poolId,
        text: text.trim(),
        address,
        message,
        signature,
        feeBlock,
      });
      const data = result.data as { ok: boolean };
      if (data.ok) {
        setText("");
        setSubmitSuccess(true);
        setTimeout(() => setSubmitSuccess(false), 3000);
        await fetchComments();
      }
    } catch (err: any) {
      const msg = err?.message || err?.details || "Failed to submit comment";
      setError(msg);
      console.error("Comment submission failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    const now = Date.now();
    const diffMs = now - ts;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  };

  const feeDisplay = network === "main" ? "0.05 KTA" : "0.000001 KTA";

  return (
    <div className="mt-8 mb-12 bg-white dark:bg-[#1e1e1e] shadow-md rounded-xl border border-gray-200 dark:border-[#333333] overflow-hidden transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-gray-100 dark:border-[#333333]">
        <h3 className="text-base font-bold font-heading text-gray-900 dark:text-white">
          Comments
          {comments.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">{comments.length}</span>
          )}
        </h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">On-chain</span>
      </div>

      {/* Comment Input */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-[#333333]">
        {isConnected && address ? (
          <div>
            <div className="flex items-start gap-3">
              {/* Avatar */}
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#845fbc] to-[#6b4fa0] flex items-center justify-center text-white text-xs font-bold mt-0.5">
                {address.slice(6, 8).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Write a comment..."
                  maxLength={MAX_COMMENT_LENGTH}
                  rows={2}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#444] bg-gray-50 dark:bg-[#2a2a2a] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-[#845fbc] focus:border-[#845fbc] disabled:opacity-50 transition-colors"
                />

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      {text.length}/{MAX_COMMENT_LENGTH}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      Fee: {feeDisplay}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || !text.trim()}
                    className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#845fbc] text-white hover:bg-[#724bad] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Publishing...
                      </span>
                    ) : "Post"}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-2 ml-11 text-xs text-red-500 dark:text-red-400">{error}</div>
            )}
            {submitSuccess && (
              <div className="mt-2 ml-11 text-xs text-green-500 dark:text-green-400">Comment published on-chain!</div>
            )}
          </div>
        ) : (
          <div className="text-center py-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Connect your wallet to post a comment
            </p>
          </div>
        )}
      </div>

      {/* Comments List */}
      <div className="divide-y divide-gray-100 dark:divide-[#2a2a2a]">
        {loading ? (
          <div className="px-6 py-8 text-center">
            <svg className="animate-spin h-5 w-5 mx-auto text-gray-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        ) : comments.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No comments yet. Be the first to comment!
          </div>
        ) : (
          comments.map((comment) => (
            <div key={comment.hash} className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-[#232323] transition-colors">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-[#444] dark:to-[#555] flex items-center justify-center text-white text-xs font-bold">
                  {comment.author.slice(6, 8).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Author + Timestamp */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-sm font-semibold text-gray-800 dark:text-gray-200 font-mono cursor-pointer hover:text-[#845fbc] dark:hover:text-[#ab8bdc] transition-colors"
                      title={comment.author}
                      onClick={() => navigator.clipboard.writeText(comment.author)}
                    >
                      {shortenAddress(comment.author)}
                    </span>
                    {address && comment.author === address && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#845fbc]/10 text-[#845fbc] dark:bg-[#845fbc]/20 dark:text-[#ab8bdc]">
                        You
                      </span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500" title={new Date(comment.timestamp).toLocaleString()}>
                      {formatTimestamp(comment.timestamp)}
                    </span>
                  </div>

                  {/* Comment text */}
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                    {comment.text}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
