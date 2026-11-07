import React from 'react';

function initialsOf(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const s = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  return s || 'IG';
}

interface CandidateAvatarProps {
  name?: string | null;
  photoUrl?: string | null;
  /** Size/shape/border classes, e.g. "w-8 h-8 rounded-lg border border-slate-200". */
  className?: string;
  /** Text size for the initials fallback, e.g. "text-xs". */
  textClassName?: string;
}

/**
 * Candidate photo with a neutral initials fallback. Never renders a stock /
 * random stranger photo: when the candidate uploaded no photo, their
 * initials are shown instead.
 */
export const CandidateAvatar: React.FC<CandidateAvatarProps> = ({
  name,
  photoUrl,
  className,
  textClassName
}) => {
  const url = (photoUrl || '').trim();
  if (url) {
    return (
      <img
        src={url}
        alt={name || 'Candidate'}
        className={`${className || ''} object-cover`.trim()}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={`${className || ''} flex items-center justify-center bg-orange-100 text-orange-700 font-bold select-none ${textClassName || 'text-xs'}`.trim()}
      aria-label={name || 'Candidate'}
      role="img"
    >
      {initialsOf(name)}
    </span>
  );
};
