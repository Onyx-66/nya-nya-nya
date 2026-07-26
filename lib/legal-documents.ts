export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  slug: string;
  title: string;
  summary: string;
  effectiveDate: string;
  updatedDate: string;
  sections: LegalSection[];
};

const effectiveDate = "July 26, 2026";

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "What NyaScans collects, why it is used, who can see it, and the choices available to you.",
    effectiveDate,
    updatedDate: effectiveDate,
    sections: [
      {
        id: "scope",
        title: "Scope and account data",
        paragraphs: [
          "This policy covers the NyaScans website, reader, publishing workspace, community features, wallet, support tools, and administrator services. It applies to visitors, registered readers, publishing-team members, and staff accounts.",
          "When you create or connect an account, we receive the identity details needed to authenticate you, such as your email address, display name, account identifier, role, and profile settings. We do not ask for your account password from an external identity provider.",
        ],
      },
      {
        id: "information",
        title: "Information we process",
        bullets: [
          "Profile information, avatar, banner, favorite series, follows, bookmarks, privacy choices, and achievements.",
          "Reading activity, chapter progress, unlocks, library imports and exports, task progress, and accessibility or reader preferences.",
          "Comments, votes, reactions, curated GIF selections, reports, support tickets, and moderation history.",
          "Publishing-team membership, rights records, series requests, chapter uploads, review decisions, and audit logs.",
          "Optional wallet entries, gift-card redemption, gift recipients, premium-balance or Shard transactions, Roulette requests, and order references.",
          "Technical security data such as request identifiers, session records, approximate region, device or browser information, and abuse-prevention events.",
        ],
      },
      {
        id: "uses",
        title: "How information is used",
        bullets: [
          "Provide accounts, restore reading progress, deliver entitled chapters, and operate publishing workflows.",
          "Process purchases, gifts, wallet entries, rewards, fraud checks, refunds, and support requests.",
          "Show profile or community activity only according to the visibility controls you choose.",
          "Protect users and licensed content, enforce rules, investigate abuse, and maintain reliable audit trails.",
          "Measure product reliability and aggregate usage so NyaScans can improve discovery, accessibility, and performance.",
        ],
      },
      {
        id: "sharing",
        title: "Sharing and public visibility",
        paragraphs: [
          "We do not sell personal information. Service providers may process limited data for hosting, storage, authentication, payments, email delivery, security, or support under instructions appropriate to their role.",
          "Your display name, avatar, public profile sections, comments, reactions, leaderboard position, and selected team affiliation may be visible to others. Private profile sections, reading history, wallet data, support tickets, and unpublished chapter files are not public.",
          "We may disclose information when reasonably necessary to comply with law, protect users or the service, investigate rights claims, or complete a corporate transaction subject to appropriate safeguards.",
        ],
      },
      {
        id: "retention",
        title: "Retention and security",
        paragraphs: [
          "We retain information for as long as needed to provide the service, meet legal or accounting obligations, resolve disputes, enforce agreements, and preserve security or moderation evidence. Draft uploads expire under the limits shown in Upload Center. Deletion requests may leave de-identified, legally required, transaction, or audit records.",
          "NyaScans uses access controls, private media delivery, validation, rate limits, revision checks, backups, and audit logging. No online service can guarantee absolute security; report suspected compromise promptly.",
        ],
      },
      {
        id: "choices",
        title: "Your choices and rights",
        bullets: [
          "Edit profile data and choose which supported profile sections are public.",
          "Export or import Library data, manage bookmarks and follows, and adjust reader or consent settings.",
          "Request access, correction, deletion, restriction, or portability where applicable to you.",
          "Object to or withdraw consent for optional processing without affecting earlier lawful processing.",
          "Appeal a privacy decision or complain to an applicable data-protection authority.",
        ],
        paragraphs: [
          "Send privacy requests to privacy@nyascans.com from the account email when possible. We may verify identity before acting and will explain any lawful limitation.",
        ],
      },
      {
        id: "children",
        title: "Age limits and contact",
        paragraphs: [
          "NyaScans is not directed to children under the minimum digital-consent age that applies where they live. If we learn that an ineligible child provided personal information, we will take appropriate steps to remove it.",
          "Questions about this policy can be sent to privacy@nyascans.com or through the tracked Support page.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Service",
    summary:
      "The rules for accounts, reading access, community participation, publishing, rewards, and commerce.",
    effectiveDate,
    updatedDate: effectiveDate,
    sections: [
      {
        id: "agreement",
        title: "Agreement and eligibility",
        paragraphs: [
          "By accessing NyaScans, you agree to these Terms and the linked Privacy, Content, Copyright, Cookie, and Refund policies. If you do not agree, do not use the service.",
          "You must meet the minimum age required to form an online agreement where you live. If you use NyaScans for a team or organization, you confirm that you are authorized to bind it.",
        ],
      },
      {
        id: "accounts",
        title: "Accounts and security",
        bullets: [
          "Provide accurate information, keep account access secure, and notify Support about unauthorized use.",
          "Do not sell, transfer, share, automate, or impersonate accounts or evade an account restriction.",
          "You are responsible for actions taken through your account until access is secured or the issue is reported.",
        ],
      },
      {
        id: "service",
        title: "Reading, virtual balances, and purchases",
        paragraphs: [
          "A chapter may be free, time-limited, paid, unlisted, or region-restricted. An unlock is a limited, personal, revocable right to view that chapter through NyaScans; it does not transfer copyright or permit redistribution.",
          "Optional premium balances, Shards, spins, gifts, cosmetics, and similar balances are service features, not money, bank deposits, securities, or transferable property. They may not be sold or exchanged outside supported NyaScans flows. Availability and expiration rules shown at the time of an action apply.",
          "Prices, taxes, billing terms, and refund eligibility are shown before purchase and governed by the Refund Policy. Gift cards are recipient-bound when stated and may be redeemed only once.",
        ],
      },
      {
        id: "community",
        title: "Comments and user content",
        paragraphs: [
          "You retain rights you hold in content you submit. You grant NyaScans a worldwide, non-exclusive, royalty-free license to host, reproduce, format, display, and distribute that content only as needed to operate, moderate, promote, and improve the service.",
          "You must have the rights and permissions needed for anything you submit. Do not upload personal data, copyrighted material, malicious files, or prohibited content. Curated GIFs remain subject to their applicable rights and platform controls.",
        ],
      },
      {
        id: "publishing",
        title: "Publishing teams and rights",
        paragraphs: [
          "A publishing team must accurately identify its members, role, language, territory, and lawful basis for every title. Uploading a chapter is a warranty that the team has permission to translate, distribute, monetize, or otherwise publish it through NyaScans.",
          "NyaScans may require documents, hold a release for review, return it for changes, replace or remove media, suspend uploads, or preserve evidence when rights or safety are disputed.",
        ],
      },
      {
        id: "conduct",
        title: "Prohibited conduct",
        bullets: [
          "Infringing rights, scraping protected pages, bypassing access controls, redistributing chapters, or falsifying ownership.",
          "Harassment, hate, sexual exploitation, doxxing, threats, fraud, spam, malware, deceptive automation, or coordinated manipulation.",
          "Exploiting bugs, double-spending, reward farming, forged requests, payment abuse, or interference with service operation.",
        ],
      },
      {
        id: "enforcement",
        title: "Moderation, suspension, and termination",
        paragraphs: [
          "We may remove content, limit features, reverse invalid rewards, suspend an account, or terminate access when reasonably necessary to enforce these Terms, protect the service, comply with law, or prevent harm. Where appropriate, we provide a reason and an appeal channel.",
          "You may stop using NyaScans at any time and may request account deletion. Provisions concerning rights, payments, disclaimers, disputes, and records survive where their nature requires it.",
        ],
      },
      {
        id: "disclaimers",
        title: "Disclaimers and responsibility",
        paragraphs: [
          "NyaScans is provided on an “as available” basis to the extent permitted by law. We do not promise uninterrupted operation, permanent availability of a title, or that community content is accurate.",
          "To the maximum extent permitted by law, NyaScans is not liable for indirect, incidental, special, consequential, or punitive damages. Nothing in these Terms excludes rights or liability that law does not permit us to exclude.",
          "These Terms may change for legal, security, or product reasons. Material changes will be announced with a new effective date. Questions can be sent to support@nyascans.com.",
        ],
      },
    ],
  },
  {
    slug: "copyright",
    title: "Copyright & Content Removal Policy",
    summary:
      "How rights holders can report material, how NyaScans reviews it, and how affected publishers can respond.",
    effectiveDate,
    updatedDate: effectiveDate,
    sections: [
      {
        id: "report",
        title: "Submit a copyright report",
        paragraphs: [
          "Send a complete notice to copyright@nyascans.com. A tracked Support ticket may also be used for non-sensitive follow-up. To locate material quickly, include each NyaScans series or chapter URL rather than a home-page reference.",
        ],
        bullets: [
          "Your physical or electronic signature and authority to act for the rights holder.",
          "Identification of the copyrighted work, or a representative list when one notice covers multiple works.",
          "The exact URL or other information sufficient to locate each allegedly infringing item.",
          "Your name, organization, mailing address, telephone number, and email address.",
          "A good-faith statement that the disputed use is not authorized by the rights holder, its agent, or law.",
          "A statement, under penalty of perjury, that the notice is accurate and you are authorized to act.",
        ],
      },
      {
        id: "review",
        title: "Review and quarantine",
        paragraphs: [
          "NyaScans logs the report, checks that it is complete, and may temporarily quarantine material while reviewing rights records. We may ask for clarification, notify the responsible team, preserve relevant evidence, restrict monetization, or remove access. Incomplete or abusive notices may be rejected.",
          "When action is taken, we normally provide the affected uploader with the claim reference and a description of the removed material, unless law or safety prevents disclosure.",
        ],
      },
      {
        id: "counter",
        title: "Counter-notice",
        paragraphs: [
          "If material was removed because of mistake or misidentification, the affected uploader may send a counter-notice to copyright@nyascans.com containing the following information:",
        ],
        bullets: [
          "A physical or electronic signature.",
          "Identification of the removed material and where it appeared before removal.",
          "A statement under penalty of perjury that removal resulted from mistake or misidentification.",
          "Name, address, telephone number, and consent to the jurisdiction and service-of-process requirements applicable under 17 U.S.C. § 512(g), where that procedure applies.",
        ],
      },
      {
        id: "restoration",
        title: "Restoration, repeat infringement, and abuse",
        paragraphs: [
          "Where the U.S. counter-notice process applies, NyaScans may restore material after the statutory waiting period—commonly 10 to 14 business days after forwarding a valid counter-notice—unless the claimant provides notice of a court action. Other jurisdictions may require a different process.",
          "Accounts or teams that repeatedly infringe rights may lose upload privileges or be terminated in appropriate circumstances. Knowingly making material misrepresentations in a notice or counter-notice may create legal liability.",
          "Registry or designated-agent information required by applicable law, if any, controls over any conflicting contact detail on this page.",
        ],
      },
    ],
  },
  {
    slug: "content-policy",
    title: "Content Policy",
    summary:
      "The safety and quality rules for titles, chapters, profiles, comments, GIFs, and publishing activity.",
    effectiveDate,
    updatedDate: effectiveDate,
    sections: [
      {
        id: "standards",
        title: "Core standards",
        bullets: [
          "Publish only material you are authorized to distribute and label its language, format, age rating, spoilers, and content warnings accurately.",
          "Do not post child sexual abuse material, sexual exploitation, non-consensual intimate imagery, grooming, or sexualized depictions of minors.",
          "Do not threaten, harass, dehumanize, promote hate, coordinate abuse, or reveal another person’s private information.",
          "Do not glorify self-harm, provide instructions for serious wrongdoing, distribute malware, impersonate others, manipulate metrics, or spam.",
          "Graphic violence or mature sexual themes require appropriate ratings and may be restricted by age, region, or surface.",
        ],
      },
      {
        id: "community",
        title: "Comments, reactions, and profiles",
        paragraphs: [
          "Discuss the work, not the worth or identity of other readers. Use spoiler controls and chapter attribution. Curated GIFs, avatars, banners, and cosmetics must follow the same rules as text.",
          "Criticism, disagreement, and fictional themes are allowed when they do not cross into targeted abuse, unlawful content, or credible harm.",
        ],
      },
      {
        id: "enforcement",
        title: "Enforcement and appeals",
        paragraphs: [
          "NyaScans may add warnings, reduce visibility, remove content, lock a thread, restrict a feature, suspend an account, or refer urgent threats to appropriate services. Severity, context, intent, history, and risk inform the response.",
          "Use the report control on the relevant content or open a Support ticket. Appeals should identify the decision, explain the error, and provide any permitted evidence. A different reviewer may reassess the outcome where practical.",
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    summary:
      "How browser storage and similar technologies keep NyaScans secure, remember choices, and measure reliability.",
    effectiveDate,
    updatedDate: effectiveDate,
    sections: [
      {
        id: "uses",
        title: "What NyaScans stores",
        bullets: [
          "Strictly necessary session and security values used for sign-in, request integrity, fraud prevention, and access control.",
          "Preference values for theme, reader layout, Library view, privacy choices, dismissed notices, and other settings.",
          "Limited analytics identifiers used to count sessions, diagnose errors, and understand aggregate navigation when permitted.",
        ],
      },
      {
        id: "control",
        title: "Your controls",
        paragraphs: [
          "Necessary storage cannot be disabled through NyaScans because the account and entitlement service would not function. Optional analytics or marketing choices, when offered, can be changed in account consent settings.",
          "You can also clear site data in your browser. Doing so may sign you out, reset reader preferences, and remove locally stored drafts or choices. Browser privacy controls may affect optional measurement.",
        ],
      },
      {
        id: "contact",
        title: "Third parties and contact",
        paragraphs: [
          "Authentication, payment, hosting, and media providers may set or read strictly scoped values when their service is used. Their policies govern data they independently control.",
          "Questions can be sent to privacy@nyascans.com.",
        ],
      },
    ],
  },
  {
    slug: "refunds",
    title: "Refund Policy",
    summary:
      "When a purchase, membership, gift, or chapter unlock may be reversed and how to request review.",
    effectiveDate,
    updatedDate: effectiveDate,
    sections: [
      {
        id: "eligibility",
        title: "Eligible requests",
        bullets: [
          "A duplicate charge, unauthorized transaction, incorrect amount, or payment captured without delivery.",
          "A purchased feature that is materially unavailable because of a verified service fault and cannot be restored promptly.",
          "A refund required by consumer law or an applicable payment-provider rule.",
        ],
      },
      {
        id: "limits",
        title: "Normally non-refundable",
        paragraphs: [
          "Consumed chapter unlocks, redeemed gift cards, transferred team support, used Roulette spins, spent virtual balances, and delivered cosmetics are normally final unless the transaction was defective, unauthorized, or law requires otherwise.",
          "Shards and promotional rewards have no cash value. Reversing a related transaction may remove unused rewards or create a correcting wallet entry.",
        ],
      },
      {
        id: "request",
        title: "How to request review",
        paragraphs: [
          "Open a tracked Support ticket under Purchases and include the order reference, date, amount, payment method category, and reason. Do not send full card details or a complete gift code.",
          "Requests should be made promptly, normally within 14 days of the transaction unless a longer legal period applies. Approved refunds return through the original method when possible; provider processing times vary.",
        ],
      },
    ],
  },
];

export const LEGAL_DOCUMENTS_BY_SLUG = Object.fromEntries(
  LEGAL_DOCUMENTS.map((document) => [document.slug, document]),
) as Record<string, LegalDocument>;
