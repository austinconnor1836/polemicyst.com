import { AiFillFacebook, AiFillGoogleCircle, AiFillTwitterCircle } from "react-icons/ai";
import { FaBluesky } from "react-icons/fa6";
import { signIn } from "next-auth/react";

const providers = [
  { id: "bluesky", name: "Bluesky", color: "#0085FF", icon: <FaBluesky size={24} /> },
  { id: "facebook", name: "Facebook", color: "#1877F2", icon: <AiFillFacebook size={24} /> },
  { id: "google", name: "Google", color: "#DB4437", icon: <AiFillGoogleCircle size={24} /> },
  { id: "twitter", name: "Twitter", color: "#1DA1F2", icon: <AiFillTwitterCircle size={24} /> },
];

export default function LoginButtons() {
  return (
    <div className="flex flex-col space-y-4">
      {providers.map((provider) => (
        <button
          key={provider.id}
          onClick={() => signIn(provider.id)}
          className="flex items-center justify-center w-full px-4 py-2 text-white rounded-md"
          style={{ backgroundColor: provider.color }}
        >
          {provider.icon}
          <span className="ml-2">Continue with {provider.name}</span>
        </button>
      ))}
    </div>
  );
}
