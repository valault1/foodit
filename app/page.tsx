'use client'

import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Bookmark,
  Clock3,
  Flame,
  Heart,
  Leaf,
  Plus,
  Search,
  Star,
  Utensils,
} from 'lucide-react'

type Recipe = {
  id: number
  title: string
  description: string
  category: string
  time: string
  rating: number
  image: string
  featured?: boolean
}

const recipes: Recipe[] = [
  { id: 1, title: 'Creamy Tuscan Pasta', description: 'Silky sauce, sun-dried tomatoes, and a little weeknight magic.', category: 'Dinner', time: '30 min', rating: 4.9, image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=85', featured: true },
  { id: 2, title: 'Crispy Salmon Bowl', description: 'A bright, balanced bowl with avocado and sesame greens.', category: 'Healthy', time: '25 min', rating: 4.8, image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=700&q=85' },
  { id: 3, title: 'Garden Focaccia', description: 'Golden, airy bread topped like a tiny edible garden.', category: 'Baking', time: '2 hr', rating: 4.7, image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=85' },
  { id: 4, title: 'Miso Butter Corn', description: 'Sweet summer corn with umami-rich miso butter.', category: 'Sides', time: '15 min', rating: 4.9, image: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=700&q=85' },
]

const categories = ['All recipes', 'Dinner', 'Healthy', 'Baking', 'Sides']

export default function Page() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All recipes')
  const [saved, setSaved] = useState<number[]>([])

  const filteredRecipes = useMemo(() => recipes.filter((recipe) => {
    const matchesCategory = category === 'All recipes' || recipe.category === category
    const matchesQuery = `${recipe.title} ${recipe.description}`.toLowerCase().includes(query.toLowerCase())
    return matchesCategory && matchesQuery
  }), [category, query])

  const toggleSaved = (id: number) => setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  return (
    <main className="min-h-screen bg-[#f8f7f2] text-[#26342d]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <a href="#top" className="flex items-center gap-3" aria-label="Savor home">
          <span className="flex size-10 items-center justify-center rounded-full bg-[#dcead7] text-[#50755c]"><Leaf /></span>
          <span className="font-serif text-2xl font-semibold tracking-tight">savor<span className="text-[#e88b5b]">.</span></span>
        </a>
        <nav className="hidden items-center gap-8 text-sm font-medium text-[#68766d] md:flex" aria-label="Primary navigation">
          <a href="#discover" className="text-[#26342d]">Discover</a>
          <a href="#saved">My cookbook <span className="ml-1 rounded-full bg-[#e88b5b] px-1.5 py-0.5 text-[10px] text-white">{saved.length}</span></a>
          <a href="#about">About</a>
        </nav>
        <button className="flex items-center gap-2 rounded-full bg-[#26342d] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3d5145]"><Plus /> Share a recipe</button>
      </header>

      <section id="top" className="mx-auto grid max-w-7xl gap-10 px-6 pb-16 pt-10 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:px-10 lg:pt-16">
        <div>
          <p className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-[#e88b5b]"><Flame /> Fresh from the kitchen</p>
          <h1 className="max-w-xl font-serif text-5xl leading-[1.03] tracking-tight text-[#26342d] md:text-7xl">Good food, <em className="font-normal text-[#e88b5b]">made simple.</em></h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-[#68766d]">Recipes for real life. Seasonal, unfussy, and always worth sharing around the table.</p>
          <div className="relative mt-9 max-w-lg">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-[#91a096]" />
            <label htmlFor="recipe-search" className="sr-only">Search recipes</label>
            <input id="recipe-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by recipe, ingredient..." className="w-full rounded-full border border-[#dfe4dc] bg-white py-4 pl-13 pr-5 text-sm shadow-[0_8px_30px_rgba(38,52,45,0.06)] outline-none transition placeholder:text-[#9ca8a0] focus:border-[#e88b5b] focus:ring-2 focus:ring-[#e88b5b]/20" />
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[2rem] bg-[#dcead7] p-3 shadow-[0_24px_60px_rgba(38,52,45,0.12)]">
          <img src={recipes[0].image} alt="Creamy Tuscan pasta in a bowl" className="h-[360px] w-full rounded-[1.5rem] object-cover lg:h-[420px]" />
          <div className="absolute bottom-8 left-8 right-8 flex items-end justify-between rounded-2xl bg-white/90 p-5 backdrop-blur-sm">
            <div><p className="mb-1 text-xs font-bold uppercase tracking-widest text-[#e88b5b]">Recipe of the week</p><h2 className="font-serif text-2xl font-semibold">Creamy Tuscan Pasta</h2></div>
            <span className="flex items-center gap-1 text-sm font-semibold"><Star className="fill-[#e88b5b] text-[#e88b5b]" /> 4.9</span>
          </div>
        </div>
      </section>

      <section id="discover" className="mx-auto max-w-7xl px-6 pb-24 lg:px-10">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[#91a096]">Explore</p><h2 className="font-serif text-4xl font-semibold">What are you craving?</h2></div><button className="flex items-center gap-2 text-sm font-semibold text-[#e88b5b]">View all recipes <ArrowRight /></button></div>
        <div className="mb-10 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Recipe categories">
          {categories.map((item) => <button key={item} onClick={() => setCategory(item)} role="tab" aria-selected={category === item} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold transition ${category === item ? 'bg-[#26342d] text-white' : 'bg-white text-[#68766d] hover:bg-[#eaf0e7]'}`}>{item}</button>)}
        </div>
        {filteredRecipes.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRecipes.slice(1).concat(filteredRecipes[0]?.id === 1 ? [] : []).map((recipe) => <article key={recipe.id} className="group overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgba(38,52,45,0.05)] transition hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(38,52,45,0.1)]"><div className="relative"><img src={recipe.image} alt={recipe.title} className="h-56 w-full object-cover transition duration-500 group-hover:scale-105" /><button onClick={() => toggleSaved(recipe.id)} aria-label={saved.includes(recipe.id) ? `Remove ${recipe.title} from saved recipes` : `Save ${recipe.title}`} className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/90 text-[#26342d] backdrop-blur-sm"><Bookmark className={saved.includes(recipe.id) ? 'fill-[#e88b5b] text-[#e88b5b]' : ''} /></button></div><div className="p-5"><div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#91a096]"><span>{recipe.category}</span><span className="flex items-center gap-1 normal-case tracking-normal text-[#68766d]"><Clock3 /> {recipe.time}</span></div><h3 className="font-serif text-2xl font-semibold">{recipe.title}</h3><p className="mt-2 text-sm leading-6 text-[#68766d]">{recipe.description}</p><div className="mt-5 flex items-center gap-1 text-sm font-semibold"><Star className="fill-[#e88b5b] text-[#e88b5b]" /> {recipe.rating}</div></div></article>)}
        </div> : <div className="rounded-3xl bg-white p-12 text-center"><Utensils className="mx-auto mb-4 text-[#e88b5b]" /><h3 className="font-serif text-2xl font-semibold">Nothing on the menu yet</h3><p className="mt-2 text-[#68766d]">Try a different search or category.</p></div>}
      </section>

      <footer id="about" className="border-t border-[#e0e5dd] bg-[#eef3eb] px-6 py-10 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 text-sm text-[#68766d] sm:flex-row"><p><span className="font-serif text-lg font-semibold text-[#26342d]">savor.</span> Made for the meals that matter.</p><p>Starter API: <code className="rounded bg-white px-2 py-1 text-xs">GET /api/recipes</code></p></div></footer>
    </main>
  )
}
