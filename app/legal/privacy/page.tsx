"use client"

import Link from "next/link"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { ArrowLeft } from "lucide-react"

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <HolographicBlobs />
      
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
          <Link 
            href="/"
            className="flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>

        {/* Content */}
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8 md:p-12">
          <h1 className="font-display font-black text-3xl md:text-4xl text-foreground mb-2">
            Privacy Policy
          </h1>
          <p className="text-foreground-muted mb-8">
            Last updated: March 20, 2024
          </p>

          <div className="prose prose-invert max-w-none space-y-8">
            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">1. Introduction</h2>
              <p className="text-foreground-secondary leading-relaxed">
                LIGAMENT (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) respects your privacy and is committed to protecting your personal data. 
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our 
                vendor orchestration platform.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">2. Information We Collect</h2>
              
              <h3 className="font-display font-bold text-lg text-foreground mt-6 mb-3">2.1 Information You Provide</h3>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li><strong className="text-foreground">Account Information:</strong> Name, email address, company name, phone number, and password</li>
                <li><strong className="text-foreground">Profile Information:</strong> Company details, capabilities, credentials, portfolio samples, and team member information</li>
                <li><strong className="text-foreground">Financial Information:</strong> Payment details, banking information, tax identification numbers (W-9/W-8 forms), and billing addresses</li>
                <li><strong className="text-foreground">Project Data:</strong> RFPs, bids, contracts, deliverables, and communications related to projects</li>
                <li><strong className="text-foreground">Documents:</strong> NDAs, MSAs, insurance certificates, and other legal documents uploaded to the platform</li>
              </ul>

              <h3 className="font-display font-bold text-lg text-foreground mt-6 mb-3">2.2 Automatically Collected Information</h3>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li>Device information (browser type, operating system, device identifiers)</li>
                <li>Log data (IP address, access times, pages viewed, referral URLs)</li>
                <li>Usage data (features used, actions taken, time spent on pages)</li>
                <li>Cookies and similar tracking technologies</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">3. How We Use Your Information</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">We use collected information to:</p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li>Provide, maintain, and improve the Platform</li>
                <li>Process transactions and send related information</li>
                <li>Facilitate connections between Lead Agencies and Partners</li>
                <li>Send notifications about RFPs, bids, project updates, and payments</li>
                <li>Respond to comments, questions, and support requests</li>
                <li>Monitor and analyze usage patterns and trends</li>
                <li>Detect, prevent, and address technical issues and security threats</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">4. Information Sharing</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">We may share your information in the following circumstances:</p>
              
              <h3 className="font-display font-bold text-lg text-foreground mt-6 mb-3">4.1 Between Platform Users</h3>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                When you engage with other users through the Platform, certain information is shared to facilitate collaboration:
              </p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li><strong className="text-foreground">Lead Agencies</strong> can view Partner profiles, capabilities, credentials, and bid submissions</li>
                <li><strong className="text-foreground">Partners</strong> can view Lead Agency company information and project details in RFPs they receive</li>
              </ul>

              <h3 className="font-display font-bold text-lg text-foreground mt-6 mb-3">4.2 Service Providers</h3>
              <p className="text-foreground-secondary leading-relaxed">
                We may share information with third-party vendors who perform services on our behalf, including payment 
                processing, data analysis, email delivery, hosting services, and customer service.
              </p>

              <h3 className="font-display font-bold text-lg text-foreground mt-6 mb-3">4.3 Legal Requirements</h3>
              <p className="text-foreground-secondary leading-relaxed">
                We may disclose information if required by law, regulation, legal process, or governmental request.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">5. Data Security</h2>
              <p className="text-foreground-secondary leading-relaxed">
                We implement appropriate technical and organizational measures to protect your personal data against 
                unauthorized access, alteration, disclosure, or destruction. These measures include encryption, secure 
                data storage, access controls, and regular security assessments. However, no method of transmission over 
                the Internet or electronic storage is 100% secure.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">6. Data Retention</h2>
              <p className="text-foreground-secondary leading-relaxed">
                We retain your personal data for as long as your account is active or as needed to provide services. 
                We may retain certain information as required by law, for legitimate business purposes, or to resolve 
                disputes. Project-related data may be retained for the duration required by applicable record-keeping 
                regulations.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">7. Your Rights</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">Depending on your location, you may have the right to:</p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li>Access the personal data we hold about you</li>
                <li>Request correction of inaccurate data</li>
                <li>Request deletion of your data (subject to legal obligations)</li>
                <li>Object to or restrict processing of your data</li>
                <li>Request portability of your data</li>
                <li>Withdraw consent where processing is based on consent</li>
              </ul>
              <p className="text-foreground-secondary leading-relaxed mt-4">
                To exercise these rights, please contact us at{" "}
                <a href="mailto:privacy@withligament.com" className="text-accent hover:underline">privacy@withligament.com</a>.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">8. Cookies and Tracking</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                We use cookies and similar tracking technologies to collect and track information about your use of the 
                Platform. You can set your browser to refuse cookies, but some features of the Platform may not function 
                properly without them.
              </p>
              <p className="text-foreground-secondary leading-relaxed">
                We use the following types of cookies:
              </p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4 mt-2">
                <li><strong className="text-foreground">Essential cookies:</strong> Required for Platform functionality</li>
                <li><strong className="text-foreground">Analytics cookies:</strong> Help us understand how users interact with the Platform</li>
                <li><strong className="text-foreground">Preference cookies:</strong> Remember your settings and preferences</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">9. International Data Transfers</h2>
              <p className="text-foreground-secondary leading-relaxed">
                Your information may be transferred to and processed in countries other than your country of residence. 
                These countries may have different data protection laws. We ensure appropriate safeguards are in place 
                for such transfers in accordance with applicable law.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">10. Children&apos;s Privacy</h2>
              <p className="text-foreground-secondary leading-relaxed">
                The Platform is not intended for individuals under 18 years of age. We do not knowingly collect personal 
                data from children. If you believe we have collected information from a child, please contact us immediately.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">11. California Privacy Rights (CCPA)</h2>
              <p className="text-foreground-secondary leading-relaxed">
                California residents have additional rights under the California Consumer Privacy Act (CCPA), including 
                the right to know what personal information we collect, the right to delete personal information, and 
                the right to opt-out of the sale of personal information. We do not sell personal information.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">12. Changes to This Policy</h2>
              <p className="text-foreground-secondary leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of any material changes by 
                posting the new Privacy Policy on this page and updating the &ldquo;Last updated&rdquo; date. We encourage you to 
                review this Privacy Policy periodically.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">13. Contact Us</h2>
              <p className="text-foreground-secondary leading-relaxed">
                If you have questions about this Privacy Policy or our data practices, please contact us at:
              </p>
              <div className="mt-4 p-4 bg-white/5 rounded-lg border border-border/30">
                <p className="text-foreground-secondary">
                  <strong className="text-foreground">LIGAMENT Privacy Team</strong><br />
                  Email: <a href="mailto:privacy@withligament.com" className="text-accent hover:underline">privacy@withligament.com</a><br />
                  Address: 123 Innovation Drive, Suite 400, San Francisco, CA 94105
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-foreground-muted">
          <Link href="/legal/privacy" className="text-accent">Privacy Policy</Link>
          <span className="mx-3">|</span>
          <Link href="/legal/terms" className="hover:text-foreground">Terms of Service</Link>
        </div>
      </div>
    </div>
  )
}
