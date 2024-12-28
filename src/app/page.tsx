import Image from 'next/image';
import Link from 'next/link';
import './backdrop-animation.css';

const HomePage: React.FC = () => {
  return (
    <div className="flex flex-col w-full h-screen bg-gray-100 dark:bg-gray-900 dark:text-white">
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto w-full">
        {/* Solar System Animation */}
        <section className="w-full h-screen bg-black relative overflow-hidden">
          <div className="el">
          </div>
          <h1 id='animated-text'>POLEMICYST</h1>
        </section>
        {/* Featured Video */}
        <section className="w-full py-16">
          <div className="container mx-auto text-center">
            <h2 className="text-3xl font-bold mb-8">Featured Video</h2>
            <div className="relative w-full h-64 md:h-96">
              <iframe
                className="absolute inset-0 w-full h-full"
                src="https://www.youtube.com/embed/your-featured-video-id"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title="Featured Video"
              ></iframe>
            </div>
          </div>
        </section>

        {/* Footer Section */}
        <footer className="bg-gray-800 text-white py-16">
          <div className="container mx-auto grid grid-cols-1 md:grid-cols-5 gap-8">
            {/* First Row */}
            <div className="col-span-1">
              <Image src="/images/polemicyst-title.png" alt="Polemicyst Logo" width={200} height={250} />
            </div>
            <div className="col-span-2">
              <h2 className="text-xl mb-4">Sign Up for the Newsletter</h2>
              <form className="flex">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="p-2 rounded-l-lg w-full"
                />
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-r-lg">
                  Sign Up
                </button>
              </form>
            </div>
            <div className="col-span-2"></div>

            {/* Second Row */}
            <div className="col-span-1">
              <div className="flex space-x-4">
                <h3 className="text-lg mb-2">Listen</h3>
                <Link href="https://spotify.com">
                  <Image src="/images/spotify.svg" alt="Spotify" width={24} height={24} />
                </Link>
              </div>
              <div className="mt-4 flex">
                <h3 className="text-lg mb-2">Follow</h3>
                <div className="flex space-x-2">
                  <Link href="https://facebook.com">
                    <Image src="/path/to/facebook-icon.png" alt="Facebook" width={24} height={24} />
                  </Link>
                  {/* Add other social media icons here */}
                </div>
              </div>
            </div>
            <div className="col-span-1">
              <h3 className="text-lg mb-2">SHOWS</h3>
            </div>
            <div className="col-span-1">
              <h3 className="text-lg mb-2">ABOUT</h3>
              <ul>
                <li>About Polemicyst</li>
                <li>Sponsors</li>
                <li>FAQs</li>
              </ul>
            </div>
            <div className="col-span-1">
              <h3 className="text-lg mb-2">EXPLORE</h3>
              <ul>
                <li>Book Recommendations</li>
              </ul>
            </div>
            <div className="col-span-1">
              <h3 className="text-lg mb-2">CONTACT</h3>
              <ul>
                <li>Login</li>
                <li>Membership</li>
              </ul>
            </div>
          </div>
        </footer>

        {/* Final Section */}
        <section className="bg-gray-900 text-white py-4 text-center">
          <p>© Polemicyst. All Rights Reserved.</p>
        </section>
      </div>
    </div>
  );
};

export default HomePage;