import Link from "next/link"

export default function TermsPage() {
  return (
    <main className="min-h-screen px-6 py-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-card/70 p-6 sm:p-8 lg:p-10">
        <div className="mb-8 border-b border-border pb-6">
          <Link href="/" className="font-mono text-xs text-accent hover:underline">
            ← Back to Home
          </Link>
          <h1 className="mt-4 font-display text-3xl font-black tracking-tight text-foreground">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Liveligood, Inc. (Ligament) • Last Updated: April 15, 2026
          </p>
        </div>

        <article className="space-y-7 text-sm leading-7 text-foreground-muted">
          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">1. Acceptance of Terms</h2>
            <p>
              These Terms of Service ("Terms") govern your access to and use of Ligament. By accessing or using Ligament,
              you agree to be bound by these Terms. If you are using Ligament on behalf of an organization, you represent
              that you are authorized to bind that organization to these Terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">2. Description of Service</h2>
            <p>
              Ligament is an AI-powered vendor orchestration SaaS platform for independent creative and production
              agencies. Ligament is operated by Liveligood, Inc., an S-Corp organized in New York. The platform helps
              agencies source partners, manage project workflows, facilitate onboarding and legal coordination, and oversee
              payment and operational collaboration across vendor relationships.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">3. User Accounts and Registration</h2>
            <p>
              You must provide accurate registration information and maintain the security of your account credentials. You
              are responsible for all activity under your account and must promptly notify us of unauthorized access. We may
              suspend or restrict access if account information is inaccurate, misleading, or used in violation of these
              Terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">4. Acceptable Use Policy</h2>
            <p>You agree not to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Use the service for unlawful, fraudulent, or deceptive purposes;</li>
              <li>Attempt unauthorized access to systems, data, or other accounts;</li>
              <li>Upload malicious code, malware, or harmful content;</li>
              <li>Interfere with or disrupt service availability or security controls;</li>
              <li>Use the platform to violate contractual, confidentiality, or intellectual property rights.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">5. Subscription and Payment Terms</h2>
            <p>
              Paid features are provided under subscription plans. Fees, billing cadence, and plan limits are described at
              purchase or renewal. You authorize us (or our billing providers) to collect applicable fees and taxes.
              Except where required by law, fees are non-refundable. We may modify pricing with advance notice for future
              billing periods.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">6. Intellectual Property</h2>
            <p>
              You retain ownership of your data, files, project materials, and other content you submit to Ligament.
              Liveligood, Inc. retains all rights, title, and interest in the Ligament platform, software, models,
              interfaces, documentation, and related intellectual property. Subject to these Terms, we grant you a limited,
              non-exclusive, non-transferable right to use the service during your active subscription.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">7. Data and Privacy</h2>
            <p>
              Platform data is stored on Supabase hosted on AWS US-East. AI-powered features process relevant content using
              the Anthropic API. File storage uses Vercel Blob. Your use of Ligament is also governed by our Privacy Policy,
              which explains how data is collected, processed, and protected.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">8. Confidentiality</h2>
            <p>
              Ligament supports workflows involving confidential information and may facilitate NDA and confidentiality
              agreements between agency users and partners. Each party remains responsible for complying with its contractual
              confidentiality obligations. You agree to use reasonable safeguards to protect confidential information accessed
              through the platform.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Liveligood, Inc. and its affiliates, officers, employees, and service
              providers are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of
              profits, revenue, data, or goodwill, arising out of or related to your use of Ligament.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">10. Disclaimers and Warranties</h2>
            <p>
              Ligament is provided on an "as is" and "as available" basis. We disclaim all warranties, express or implied,
              including merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee that
              the service will be uninterrupted, error-free, or suitable for every workflow.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">11. Termination</h2>
            <p>
              You may stop using the service at any time. We may suspend or terminate access for violation of these Terms,
              security concerns, non-payment, or legal compliance needs. Upon termination, your right to access the service
              ends, subject to any data retention or export rights described in your plan or applicable law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">12. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the State of New York, without regard to conflict of laws principles.
              Any disputes arising from or relating to these Terms or the service shall be resolved in courts located in New
              York, New York, unless otherwise required by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">13. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. Material changes will be communicated through reasonable means,
              such as in-product notice or email. Continued use of Ligament after updates become effective constitutes
              acceptance of the revised Terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">14. Contact Information</h2>
            <p>
              For legal notices or questions about these Terms, contact:
              <br />
              hello@withligament.com
              <br />
              Liveligood, Inc.
              <br />
              New York, NY
            </p>
          </section>
        </article>
      </div>
    </main>
  )
}
