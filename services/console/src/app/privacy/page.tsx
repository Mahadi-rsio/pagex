import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
    title: "Privacy Policy — Cloudisy Console",
    description: "Privacy Policy for Cloudisy Console",
};

export default function PrivacyPage() {
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

                <h1 className="text-3xl font-bold tracking-tight mb-2">Privacy Policy</h1>
                <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().getFullYear()}</p>

                <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-muted-foreground leading-relaxed">
                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">1. Information We Collect</h2>
                        <p>
                            We collect information you provide directly to us, such as your name and email address
                            when you create an account. We also collect usage data to improve our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">2. How We Use Your Information</h2>
                        <p>
                            We use the information we collect to provide, maintain, and improve our services,
                            communicate with you, and comply with legal obligations.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">3. Data Security</h2>
                        <p>
                            We implement appropriate technical and organizational measures to protect your personal
                            information against unauthorized access, alteration, disclosure, or destruction.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-lg font-semibold text-foreground mb-2">4. Contact Us</h2>
                        <p>
                            If you have any questions about this Privacy Policy, please contact us through the
                            support channel in your console settings.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
