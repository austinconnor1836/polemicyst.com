import { Suspense } from "react";
import SignInClient from "./SignInClient";

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="text-center mt-10">Loading sign-in...</div>}>
      <SignInClient />
    </Suspense>
  );
}
