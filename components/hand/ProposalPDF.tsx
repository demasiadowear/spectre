import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { formatCurrency } from "@/lib/utils";
import type { ProposalContent } from "@/types";

// Client-only PDF document. Imported dynamically from HandWizard so
// @react-pdf/renderer never enters the SSR bundle. Uses the SPECTRE
// palette (ink text, cyan/magenta accents) on a light page.

const C = {
  ink: "#3A3327",
  cyan: "#9A3412",
  magenta: "#B0492B",
  muted: "#8C7B63",
  line: "#d8dde3",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 10,
    color: C.ink,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: C.magenta,
    paddingBottom: 8,
    marginBottom: 18,
  },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 2 },
  kicker: {
    fontSize: 8,
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginBottom: 16,
  },
  section: { marginBottom: 12 },
  heading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.cyan,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 3,
  },
  body: { fontSize: 10, color: C.ink },
  pricingRow: { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 16 },
  tier: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 2,
    padding: 10,
  },
  tierName: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.magenta,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  tierPrice: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginVertical: 4,
  },
  tierDesc: { fontSize: 8, color: C.muted },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 12 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: C.muted,
  },
});

interface ProposalPDFProps {
  proposal: ProposalContent;
  company: string;
}

export default function ProposalPDF({ proposal, company }: ProposalPDFProps) {
  return (
    <Document title={proposal.title} author="AYROMEX">
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>AYROMEX</Text>
          <Text style={styles.kicker}>Proposta operativa</Text>
        </View>

        <Text style={styles.title}>{proposal.title}</Text>

        {proposal.sections.map((s, i) => (
          <View key={i} style={styles.section} wrap={false}>
            <Text style={styles.heading}>{s.heading}</Text>
            {s.body.split("\n").map((line, j) => (
              <Text key={j} style={styles.body}>
                {line}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.pricingRow}>
          {proposal.pricing.map((tier, i) => (
            <View key={i} style={styles.tier}>
              <Text style={styles.tierName}>{tier.name}</Text>
              <Text style={styles.tierPrice}>{formatCurrency(tier.price)}</Text>
              <Text style={styles.tierDesc}>{tier.description}</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.heading}>Email di accompagnamento</Text>
          <Text style={[styles.body, { fontFamily: "Helvetica-Bold" }]}>
            {proposal.email_subject}
          </Text>
          {proposal.email_body.split("\n").map((line, j) => (
            <Text key={j} style={styles.body}>
              {line}
            </Text>
          ))}
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `AYROMEX · ${company || "—"}          ayromex.com          ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
