import Link from "next/link"

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-10 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-card/70 p-6 sm:p-8 lg:p-10">
        <div className="mb-8 border-b border-border pb-6">
          <Link href="/" className="font-mono text-xs text-accent hover:underline">
            ← Back to Home
          </Link>
          <h1 className="mt-4 font-display text-3xl font-black tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Liveligood, Inc. (Ligament) • Last Updated: April 15, 2026
          </p>
        </div>

        <article className="space-y-7 text-sm leading-7 text-foreground-muted">
          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">1. Introduction and Scope</h2>
            <p>
              This Privacy Policy explains how Liveligood, Inc. ("Ligament," "we," "our," or "us") collects, uses, and
              protects information when you use the Ligament platform. This policy applies to business users, agency teams,
              and partner users accessing Ligament services.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">2. Information We Collect</h2>
            <p>We collect information you provide and information generated through platform use, including:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Account information (name, email, organization details, role data);</li>
              <li>Usage and activity data (feature interactions, workflow actions, metadata);</li>
              <li>Files and content uploaded by users (project materials, legal docs, notes, and related content).</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">3. How We Use Your Information</h2>
            <p>We use collected information to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Provide, maintain, and improve the Ligament platform;</li>
              <li>Authenticate users, secure accounts, and prevent abuse;</li>
              <li>Enable collaboration, onboarding, and payment workflow features;</li>
              <li>Deliver support communications, product updates, and operational notices;</li>
              <li>Generate AI-powered workflow recommendations and synthesis outputs.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">4. Data Storage and Security</h2>
            <p>
              Application data is stored on Supabase hosted in AWS US-East. Files are stored via Vercel Blob. We use
              commercially reasonable administrative, technical, and organizational safeguards to protect information, but no
              system can be guaranteed completely secure.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">5. AI Processing Disclosure</h2>
            <p>
              Certain features use the Anthropic API to process user-provided content for AI-powered recommendations and
              synthesis. Data sent to Anthropic for these features is subject to Anthropic&apos;s privacy practices and terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">6. Third-Party Services</h2>
            <p>We use trusted service providers to operate the platform, including:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Supabase (database and authentication infrastructure)</li>
              <li>Vercel (hosting and file storage services)</li>
              <li>Anthropic (AI processing services)</li>
              <li>Resend (email delivery)</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">7. Data Sharing</h2>
            <p>
              We do not sell personal data. We share data only as necessary with the service providers listed above to
              deliver and maintain platform functionality, or when required by law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">8. User Rights</h2>
            <p>
              Depending on applicable law, you may have rights to request access to, correction of, or deletion of personal
              data. To submit a request, contact us using the details in the Contact Information section below.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">9. Cookies and Tracking</h2>
            <p>
              Ligament uses essential cookies/session technologies for authentication and application function. We also use
              Vercel Analytics to understand product usage trends and improve performance.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">10. Data Retention</h2>
            <p>
              We retain data for as long as needed to provide services, satisfy contractual commitments, maintain security,
              comply with legal obligations, and resolve disputes. Retention periods may vary by data type and account
              status.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">11. Children&apos;s Privacy</h2>
            <p>
              Ligament is intended for business users and is not directed to children. Users must be at least 18 years old
              to use the service.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. Material updates will be posted through the platform or via
              other reasonable notice. Continued use after updates indicates acceptance of the revised policy.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-display text-xl font-bold text-foreground">13. Contact Information</h2>
            <p>
              For privacy questions or requests, contact:
              <br />
              legal@withligament.com
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
