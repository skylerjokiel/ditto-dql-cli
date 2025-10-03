# Ditto DQL Terminal

A simple command-line interface for running DQL queries against a Ditto database with a movie dataset.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the terminal:
```bash
npm run dev
```

The terminal will automatically import the movie dataset on first run.

## Basic Commands

### Terminal Commands

- **DQL Query** - Type any DQL query directly and press Enter
- `.list` - Show all available scenarios
- `.run <scenario>` - Run a predefined scenario (e.g., `.run count_all`)
- `.exit` - Exit the terminal

### Example DQL Queries

```sql
-- Count all movies
SELECT count(*) FROM movies

-- Find movies by year
SELECT * FROM movies WHERE year = 2020

-- Search by title
SELECT * FROM movies WHERE title CONTAINS 'Star'

-- Filter by rating
SELECT title, year FROM movies WHERE imdb.rating > 8.0
```

## Available Scenarios

Run `.list` to see all scenarios. Some examples:
- `count_all` - Simple count query
- `index_basic` - Index performance demo
- `index_on_id_subfield` - Indexing on ID subfields

## Adding New Scenarios

Scenarios are a list of dql commands executed in sequential order.

To add a new scenario, edit `scenarios.json`. Scenarios  and add your queries:

```json
{
  "my_scenario": [
    "SELECT count(*) FROM movies",
    "SELECT * FROM movies WHERE year > 2020",
    "SELECT title, year FROM movies ORDER BY year DESC LIMIT 10"
  ]
}
```

Then run it with `.run my_scenario`

## License

MIT