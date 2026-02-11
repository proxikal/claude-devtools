/**
 * Loading skeleton for ChatHistory while conversation is loading.
 */
export const ChatHistoryLoadingState = (): JSX.Element => {
  return (
    <div className="flex flex-1 items-center justify-center overflow-hidden bg-[#141416]">
      <div className="w-full max-w-5xl space-y-8 px-6">
        {/* Loading skeleton */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse space-y-6">
            {/* User message skeleton - right aligned */}
            <div className="flex justify-end">
              <div className="h-16 w-2/3 rounded-2xl rounded-br-sm border border-white/5 bg-[#27272A]/50" />
            </div>
            {/* AI response skeleton - left aligned with border accent */}
            <div className="border-l-2 border-white/5 pl-3">
              <div className="h-24 w-full rounded-lg bg-[#27272A]/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
