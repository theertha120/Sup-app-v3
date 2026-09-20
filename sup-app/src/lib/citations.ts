/**
 * citations.ts
 *
 * Single source of truth for every published source the app cites, so the
 * Sources & Methodology page and the in-context "sources" links shown on
 * the intervention / "time to move" pop-ups (Apple guideline 1.4.1 — health
 * recommendations must have easy-to-find citations) can't drift apart.
 * All HTTPS, all verified working links.
 */

import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";

export interface Citation {
  authors: string;
  title: string;
  venue: string;
  url: string;
}

// General evidence for wearable/IMU-based posture tracking.
export const WEARABLE_MONITORING_CITATIONS: Citation[] = [
  {
    authors: "Simpson L, Maharaj MM, Mobbs RJ",
    title: "The Role of Wearables in Spinal Posture Analysis: A Systematic Review",
    venue: "2019",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6368717/",
  },
  {
    authors: "Lee R, James C, Edwards S, et al.",
    title: "Evidence for the Effectiveness of Feedback from Wearable Inertial Sensors during Work-Related Activities: A Scoping Review",
    venue: "Sensors, 2021;21(19):6377",
    url: "https://doi.org/10.3390/s21196377",
  },
  {
    authors: "Figueira V, et al.",
    title: "Wearables for Monitoring and Postural Feedback in the Work Environment: A Scoping Review",
    venue: "Sensors, 2024;24(4):1341",
    url: "https://pubmed.ncbi.nlm.nih.gov/38400498/",
  },
];

// The accumulate-fast / recover-slow design behind s'train, and the
// "sustained slouching takes a while to recover from" pop-up copy.
export const STRAIN_CITATIONS: Citation[] = [
  {
    authors: "Kang SH, Mirka GA",
    title: "Creep Deformation of Viscoelastic Lumbar Tissue During Sustained Submaximal Trunk Flexion Postures",
    venue: "Journal of Biomechanics, 2023;155:111647",
    url: "https://pubmed.ncbi.nlm.nih.gov/37245386/",
  },
  {
    authors: "Kang SH, Mirka GA",
    title: "Cumulative Creep Response of Viscoelastic Lumbar Tissue as a Function of Work-Rest Schedule",
    venue: "Journal of Electromyography and Kinesiology, 2024;78:102916",
    url: "https://pubmed.ncbi.nlm.nih.gov/38909410/",
  },
];

// Behind the "time to move" nudge: breaking up long uninterrupted sitting with
// short active breaks (walking, stretching) and posture changes. Note the
// evidence for back pain specifically is mixed/low-quality per the 2018
// systematic review, so the app's copy says "comfortable", not "prevents pain".
export const MOVEMENT_CITATIONS: Citation[] = [
  {
    authors: "Waongenngarm P, van der Beek AJ, Akkarakittichoke N, Janwantanakul P",
    title: "Effects of an active break and postural shift intervention on preventing neck and low-back pain among high-risk office workers: a 3-arm cluster-randomized controlled trial",
    venue: "Scandinavian Journal of Work, Environment & Health, 2021;47:306-317",
    url: "https://pubmed.ncbi.nlm.nih.gov/33906239/",
  },
  {
    authors: "Waongenngarm P, Areerak K, Janwantanakul P",
    title: "The effects of breaks on low back pain, discomfort, and work productivity in office workers: A systematic review of randomized and non-randomized controlled trials",
    venue: "Applied Ergonomics, 2018;68:230-239",
    url: "https://pubmed.ncbi.nlm.nih.gov/29409639/",
  },
  {
    authors: "Bull FC, Al-Ansari SS, Biddle S, et al.",
    title: "World Health Organization 2020 guidelines on physical activity and sedentary behaviour",
    venue: "British Journal of Sports Medicine, 2020;54(24):1451-1462",
    url: "https://pubmed.ncbi.nlm.nih.gov/33239350/",
  },
];

// Opens in an in-app browser (SFSafariViewController on iOS, Custom Tabs on
// Android) rather than backgrounding the app into external Safari/Chrome.
export async function openCitation(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // Fallback if the in-app browser fails to open for any reason.
    Linking.openURL(url).catch(() => {});
  }
}
