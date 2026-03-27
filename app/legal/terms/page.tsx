"use client"

import Link from "next/link"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { ArrowLeft } from "lucide-react"

export default function TermsOfServicePage() {
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
            Terms of Service
          </h1>
          <p className="text-foreground-muted mb-8">
            Last updated: March 20, 2024
          </p>

          <div className="prose prose-invert max-w-none space-y-8">
            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">1. Acceptance of Terms</h2>
              <p className="text-foreground-secondary leading-relaxed">
                By accessing or using LIGAMENT (&ldquo;the Platform&rdquo;), you agree to be bound by these Terms of Service (&ldquo;Terms&rdquo;). 
                If you are using the Platform on behalf of an organization, you represent and warrant that you have the authority 
                to bind that organization to these Terms.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">2. Description of Service</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                LIGAMENT is a vendor orchestration platform that enables:
              </p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li><strong className="text-foreground">Lead Agencies:</strong> To manage, coordinate, and pay external vendor partners while presenting a unified team to clients.</li>
                <li><strong className="text-foreground">Partner Agencies/Freelancers:</strong> To receive project opportunities, submit bids, manage onboarding, and receive payments through the Platform.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">3. User Accounts</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                You are responsible for maintaining the confidentiality of your account credentials and for all activities 
                that occur under your account. You agree to:
              </p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li>Provide accurate, current, and complete information during registration</li>
                <li>Maintain and promptly update your account information</li>
                <li>Notify us immediately of any unauthorized access or use of your account</li>
                <li>Ensure that you exit from your account at the end of each session</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">4. Lead Agency Responsibilities</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                As a Lead Agency user, you acknowledge and agree that:
              </p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li>You are solely responsible for the accuracy of RFPs, project briefs, and scope documents you distribute through the Platform</li>
                <li>Any contracts, NDAs, or agreements executed through the Platform are between you and your partners directly</li>
                <li>LIGAMENT facilitates but does not guarantee partner performance or deliverable quality</li>
                <li>You are responsible for compliance with all applicable laws regarding contractor relationships and payments</li>
                <li>Payment obligations to partners remain your responsibility regardless of client payment status</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">5. Partner/Freelancer Responsibilities</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                As a Partner or Freelancer user, you acknowledge and agree that:
              </p>
              <ul className="list-disc list-inside text-foreground-secondary space-y-2 ml-4">
                <li>You are an independent contractor and not an employee of LIGAMENT or any Lead Agency</li>
                <li>Information submitted in bids, capabilities, and credentials must be accurate and truthful</li>
                <li>You are responsible for your own taxes, insurance, and compliance with applicable laws</li>
                <li>Confidential information received through the Platform must be protected according to applicable NDAs</li>
                <li>You will deliver work according to agreed-upon specifications, timelines, and quality standards</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">6. Confidentiality</h2>
              <p className="text-foreground-secondary leading-relaxed">
                Users may have access to confidential information of other users or their clients through the Platform. 
                You agree to maintain the confidentiality of such information and use it only for the purposes for which 
                it was shared. This obligation survives termination of your account.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">7. Intellectual Property</h2>
              <p className="text-foreground-secondary leading-relaxed mb-4">
                The Platform and its original content, features, and functionality are owned by LIGAMENT and are protected 
                by international copyright, trademark, and other intellectual property laws. Work product created through 
                engagements facilitated by the Platform is governed by the agreements between Lead Agencies and Partners.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">8. Payment Processing</h2>
              <p className="text-foreground-secondary leading-relaxed">
                LIGAMENT may facilitate payment processing between Lead Agencies and Partners. We are not responsible for 
                payment disputes between parties. All payment terms, schedules, and amounts are determined by agreements 
                between Lead Agencies and Partners. Platform fees, if applicable, will be clearly disclosed before any 
                transaction.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">9. Limitation of Liability</h2>
              <p className="text-foreground-secondary leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, LIGAMENT SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
                SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER INCURRED 
                DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES RESULTING FROM 
                YOUR USE OF THE PLATFORM.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">10. Indemnification</h2>
              <p className="text-foreground-secondary leading-relaxed">
                You agree to indemnify and hold harmless LIGAMENT and its officers, directors, employees, and agents 
                from any claims, damages, losses, liabilities, and expenses (including attorneys&apos; fees) arising out of 
                your use of the Platform or violation of these Terms.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">11. Termination</h2>
              <p className="text-foreground-secondary leading-relaxed">
                We may terminate or suspend your account and access to the Platform immediately, without prior notice, 
                for conduct that we believe violates these Terms or is harmful to other users, us, or third parties, 
                or for any other reason at our sole discretion.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">12. Governing Law</h2>
              <p className="text-foreground-secondary leading-relaxed">
                These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, 
                United States, without regard to its conflict of law provisions.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">13. Changes to Terms</h2>
              <p className="text-foreground-secondary leading-relaxed">
                We reserve the right to modify these Terms at any time. We will notify users of any material changes 
                by posting the updated Terms on the Platform and updating the &ldquo;Last updated&rdquo; date. Your continued use 
                of the Platform after such modifications constitutes acceptance of the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="font-display font-bold text-xl text-foreground mb-4">14. Contact Information</h2>
              <p className="text-foreground-secondary leading-relaxed">
                If you have any questions about these Terms, please contact us at{" "}
                <a href="mailto:legal@withligament.com" className="text-accent hover:underline">legal@withligament.com</a>.
              </p>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-foreground-muted">
          <Link href="/legal/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <span className="mx-3">|</span>
          <Link href="/legal/terms" className="text-accent">Terms of Service</Link>
        </div>
      </div>
    </div>
  )
}
