'use client';

import React, { useState, useEffect } from "react";
import StoryRow from "../_components/StoryRow";
import PostModal from "../_components/PostModal";
import { StoriesProvider, useStories } from "../context/StoriesContext";

const navigation = [
  { name: "Blog", href: "/posts" },
];

const HomeContent: React.FC = () => {
  const { stories, setStories, addStory, deleteStory } = useStories();
  const [sortOption, setSortOption] = useState("newest");
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const fetchStories = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/links');
        const data = await response.json();
        setStories(data);
      } catch (error) {
        console.error('Error fetching stories:', error);
      }
    };

    fetchStories();
  }, []);

  const sortedStories = [...stories].sort((a, b) => {
    if (sortOption === "newest") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); // Assuming stories have a createdAt field
    } else if (sortOption === "mostUpvoted") {
      return b.upvotes - a.upvotes;
    }
    return 0;
  });

  return (
    <div className="flex flex-col items-center w-screen h-screen overflow-hidden bg-gradient-to-tl from-black via-zinc-600/20 to-black mt-5"> {/* Add padding to the top */}
      <div className="hidden w-screen h-px animate-glow md:block animate-fade-left bg-gradient-to-r from-zinc-300/0 via-zinc-300/50 to-zinc-300/0" />
      <div className="mt-8 w-lvw md:w-1/2 animate-fade-in">
        <div className="mb-4 flex justify-between items-center w-full max-w-4xl">
          <div>
            <label htmlFor="sort" className="mr-2 text-white">Sort by:</label>
            <select
              id="sort"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              className="p-2 rounded"
            >
              <option value="newest">Newest</option>
              <option value="mostUpvoted">Most Upvoted</option>
            </select>
          </div>
          <button onClick={() => setIsModalOpen(true)} className="p-2 bg-blue-500 text-white rounded flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
            </svg>
            Post
          </button>
        </div>
        {sortedStories.map((story) => (
          <StoryRow
            key={story._id}
            id={story._id}
            url={story.url}
            description={story.description}
            tags={story.tags}
            upvotes={story.upvotes}
          />
        ))}
      </div>
      <PostModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={addStory} />
    </div>
  );
};

export default function Home() {
  return (
    <StoriesProvider>
      <HomeContent />
    </StoriesProvider>
  );
}