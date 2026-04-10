export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export interface ReleaseNoteEntry {
  date: string;
  sections: ReleaseNoteSection[];
}

/**
 * Bump this value whenever new release notes are added.
 * The modal will re-appear for users who haven't seen this version yet.
 */
export const RELEASE_NOTES_VERSION = "2026-04-10";

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    date: "April 10, 2026",
    sections: [
      {
        title: "Features",
        items: [
          "Added an in-game release notes modal that appears on new updates so you never miss what changed.",
        ],
      },
    ],
  },
  {
    date: "April 9, 2026",
    sections: [
      {
        title: "Features",
        items: [
          "A new tabbed leaderboard lets you switch between Nums (score ranking) and Referrals (referral ranking).",
        ],
      },
      {
        title: "Bug Fixes",
        items: [
          "Fixed an issue where the game_started event never fired, which could cause tracking inconsistencies.",
        ],
      },
    ],
  },
  {
    date: "April 3, 2026",
    sections: [
      {
        title: "Features",
        items: [
          "Power-up draws now occur at levels 6 and 12 (previously 4, 8, 12). This reduces the total number of draws from 3 to 2 but spaces them out more evenly across the game.",
        ],
      },
    ],
  },
  {
    date: "April 2, 2026",
    sections: [
      {
        title: "Bug Fixes",
        items: [
          "Fixed the welcome page SlotCounter animation that was broken on initial site load.",
          "Improved cross-browser compatibility \u2014 resolved React key warnings and improved WebKit resilience.",
          "Fixed toast notification font sizes.",
        ],
      },
    ],
  },
  {
    date: "April 1, 2026",
    sections: [
      {
        title: "Features",
        items: [
          "Events in the activity feed are now clickable links for easier navigation.",
        ],
      },
      {
        title: "Bug Fixes",
        items: [
          "Fixed referral tracking.",
          "Fixed responsive grid padding on achievement cards.",
          "Fixed score submission weight calculation.",
          "Fixed purchase title display.",
        ],
      },
    ],
  },
  {
    date: "March 31, 2026",
    sections: [
      {
        title: "Features",
        items: [
          "The Stage component now shows an unlocked visual state, making it clearer which stages you have reached.",
        ],
      },
      {
        title: "Bug Fixes",
        items: [
          "Fixed a chain reaction issue where certain trap combinations could cause unexpected behavior.",
          "Fixed VRF (randomness) verification.",
          "Fixed game icon display.",
        ],
      },
    ],
  },
];
