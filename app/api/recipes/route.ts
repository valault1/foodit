import { NextResponse } from 'next/server'

type Recipe = {
  id: number
  title: string
  description: string
  category: string
  time: string
  rating: number
  image: string
}

const recipes: Recipe[] = [
  { id: 1, title: 'Creamy Tuscan Pasta', description: 'Silky sauce, sun-dried tomatoes, and a little weeknight magic.', category: 'Dinner', time: '30 min', rating: 4.9, image: 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=85' },
  { id: 2, title: 'Crispy Salmon Bowl', description: 'A bright, balanced bowl with avocado and sesame greens.', category: 'Healthy', time: '25 min', rating: 4.8, image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=700&q=85' },
]

export async function GET() {
  return NextResponse.json({ data: recipes })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const required = ['title', 'description', 'category', 'time']
  if (!body || required.some((field) => typeof body[field] !== 'string' || !body[field].trim())) {
    return NextResponse.json({ error: 'title, description, category, and time are required' }, { status: 400 })
  }

  const recipe: Recipe = {
    id: Math.max(...recipes.map((item) => item.id), 0) + 1,
    title: body.title.trim(),
    description: body.description.trim(),
    category: body.category.trim(),
    time: body.time.trim(),
    rating: 0,
    image: typeof body.image === 'string' && body.image.trim() ? body.image.trim() : '/placeholder.jpg',
  }
  recipes.push(recipe)
  return NextResponse.json({ data: recipe }, { status: 201 })
}

// This starter uses an in-memory store for local development. Replace it with a database before production.
