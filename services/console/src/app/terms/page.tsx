import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
    title: "Terms of Service — Cloudisy Console",
    description: "Terms of Service for Cloudisy Console",
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-background text-foreground antialiased">
            <div className="max-w-3xl mx-auto px-6 py-12">
                <Link
                    href="/login"
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Link>

                <h1 className="text-3xl font-bold tracking-tight mb-2">Terms of Service</h1>
                <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().getFullYear()}</p>

                <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-muted-foreground leading-relaxed">
                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">1. Acceptance of Terms</h2>
                        <p>
                            By accessing or using Cloudisy Console, you agree to be bound by these Terms of Service.
                            If you do not agree to these terms, please do not use our service.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">2. Use of Service</h2>
                        <p>
                            You agree to use the service only for lawful purposes and in a way that does not infringe
                            the rights of others or restrict their use of the service.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">3. Account Responsibility</h2>
                        <p>
                            You are responsible for maintaining the confidentiality of your account credentials and
                            for all activities that occur under your account.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">4. Termination</h2>
                        <p>
                            We reserve the right to suspend or terminate your access to the service at our sole
                            discretion, without notice, for conduct that violates these Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">5. Contact</h2>
                        <p>
                            For questions about these Terms, please contact us through the support channel in your
                            console settings.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
