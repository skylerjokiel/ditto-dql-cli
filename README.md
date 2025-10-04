# Ditto DQL Terminal

A comprehensive command-line interface for running DQL queries against a Ditto database with a movie dataset, featuring performance benchmarking and baseline tracking capabilities.

> This application is designed for local DQL query execution and **does not enable sync** intentionally.

> To reset the database stop the application and delete the `./ditto` directory from the root.

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
- `.help` - Show help message with all available commands
- `.list` - Show all available scenarios with index numbers
- `.run <name|index>` - Run a predefined scenario by name or index number (e.g., `.run count_all` or `.run 1`)
- `.all` - Run all scenarios in sequence with comprehensive summary
- `.bench <query>` - Benchmark a custom query (20 runs with statistics)
- `.benchmarks` - List all available predefined benchmarks
- `.benchmark <name|index> [runs]` - Run a specific predefined benchmark with optional run count (default: 5)
- `.benchmark_all [runs]` - Run all predefined benchmarks with optional run count
- `.benchmark_baseline [runs]` - Run all benchmarks and save results as performance baselines (default: 50 runs)
- `.system` - Display comprehensive system information including Ditto version, hardware details, and database statistics
- `.exit` - Exit the terminal

### Example DQL Queries

```sql
-- Count all movies
SELECT count(*) FROM movies

-- Find movies by year
SELECT * FROM movies WHERE _id.year = '2001'

-- Search by title
SELECT * FROM movies WHERE CONTAINS(_id.title,'Star')

```

## Movie Document Structure

Each movie in the database has the following structure:

```json
{
  "_id": {
    "id": "573a1390f29313caabcd4135",
    "title": "Blacksmith Scene",
    "year": "1893",
    "type": "movie"
  },
  "plot": "Three men hammer on an anvil...",
  "genres": ["Short"],
  "runtime": 1,
  "cast": ["Charles Kayser", "John Ott"],
  "fullplot": "A stationary camera looks at...",
  "countries": ["USA"],
  "released": "1893-05-09T00:00:00.000Z",
  "directors": ["William K.L. Dickson"],
  "rated": "UNRATED",
  "awards": {
    "wins": 1,
    "nominations": 0,
    "text": "1 win."
  },
  "imdb": {
    "rating": 6.2,
    "votes": 1189,
    "id": 5
  },
  "tomatoes": {
    "viewer": {
      "rating": 3,
      "numReviews": 184,
      "meter": 32
    }
  }
}
```

## Test Harness & Validation

This application functions as a comprehensive test harness for DQL queries with built-in validation:

### Scenario Validation

Scenarios can include automated validation for:
- **Result Count**: Verify queries return the expected number of documents
- **Index Usage**: Automatically run EXPLAIN and validate which index is used
- **Execution Time**: Ensure queries complete within specified time limits

### Scenario Format

Scenarios support both simple strings and validation objects:

```json
{
  "my_scenario": [
    "DROP INDEX IF EXISTS my_index ON movies",
    {
      "query": "SELECT * FROM movies WHERE rated = 'PG'",
      "expectedCount": 1234,
      "expectedIndex": "full_scan",
      "maxExecutionTime": 500
    },
    "CREATE INDEX my_index ON movies (rated)",
    {
      "query": "SELECT * FROM movies WHERE rated = 'PG'", 
      "expectedCount": 1234,
      "expectedIndex": "my_index",
      "maxExecutionTime": 50
    }
  ]
}
```

### Available Scenarios

Run `.list` to see all scenarios with their index numbers. You can run scenarios either by name or index:
- `.run index_basic` or `.run 1` - Basic index performance validation
- `.run index_string_contains` or `.run 2` - Text search with CONTAINS
- `.run validation_test` or `.run 3` - Result count validation examples

Use `.all` to run all scenarios and get a comprehensive test report.

## Performance Benchmarking

### Custom Query Benchmarking

Use the `.bench` command to benchmark any custom query:

```
.bench SELECT * FROM movies WHERE rated = 'APPROVED'
```

This will run the query 20 times and provide detailed statistics:
- Mean, median, min, max execution times
- Standard deviation and percentiles (95th, 99th)
- Queries per second throughput
- Progress tracking during execution

### Predefined Benchmarks

The application includes predefined benchmark suites for common query patterns:

```
.benchmarks                    # List all available benchmarks
.benchmark count               # Run the "count" benchmark  
.benchmark 1                   # Run benchmark by index
.benchmark count 10            # Run benchmark with custom run count
.benchmark_all                 # Run all predefined benchmarks
.benchmark_all 10              # Run all benchmarks with 10 runs each
```

### Performance Baseline Tracking

Track performance changes across Ditto versions using the baseline system:

```
.benchmark_baseline            # Create baseline for current version (50 runs)
.benchmark_baseline 100        # Create baseline with custom run count
```

When running benchmarks, the system automatically compares results against:
- The current version's baseline (if available)
- Last 3 patch versions (e.g., 4.12.0, 4.12.1, 4.12.2)
- Previous minor version (e.g., 4.11.x)

The `.benchmark_all` command displays a comprehensive summary table showing performance across versions with color-coded differences:
- 🟢 Green = Performance improvement
- 🔵 Blue = Minimal change (±5%)
- 🟡 Yellow = Small regression (5-15%)
- 🔴 Red = Significant regression (>15%)

### Multi-Version Baseline Collection

For comprehensive performance testing across multiple Ditto versions:

```bash
# Collect baselines for all configured versions
npm run collect-baselines

# Collect baseline for a specific version
npm run collect-baselines -- 4.12.0
```

This automated tool:
- Switches between Ditto versions automatically
- Runs all benchmarks for each version
- Saves results to the baseline database
- Restores your original Ditto version when complete

**Adding Custom Benchmarks:**

Edit `benchmarks.json` to add new benchmark queries:

```json
{
  "my_benchmark": {
    "query": "SELECT * FROM movies WHERE runtime > 150 LIMIT 100",
    "preQueries": ["CREATE INDEX IF NOT EXISTS runtime_idx ON movies (runtime)"],
    "postQueries": ["DROP INDEX IF EXISTS runtime_idx ON movies"]
  }
}
```

Perfect for comparing indexed vs non-indexed query performance and maintaining consistent performance testing!

## System Information

The `.system` command provides comprehensive information about your environment:

```
.system
```

This displays:
- **Ditto SDK Version**: Current version and license information
- **System Information**: OS, platform, CPU, memory details
- **Storage Information**: Database location and size
- **Database Statistics**: Document counts, index information, and collection details

Use this information to:
- Ensure consistent testing environments
- Debug performance differences
- Track database growth
- Verify index usage

## Adding New Scenarios

To add a new scenario, edit `scenarios.json` and add your queries with optional validation:

```json
{
  "my_scenario": [
    "DROP INDEX IF EXISTS my_index ON movies",
    {
      "query": "SELECT * FROM movies WHERE runtime > 120",
      "expectedCount": 8500,
      "expectedIndex": "full_scan",
      "maxExecutionTime": 800
    },
    "CREATE INDEX my_index ON movies (runtime)",
    {
      "query": "SELECT * FROM movies WHERE runtime > 120",
      "expectedCount": 8500,
      "expectedIndex": "my_index", 
      "maxExecutionTime": 100
    }
  ]
}
```

Stop and restart the app then run it with `.run my_scenario`

## Recent Features

### Enhanced Benchmark Suite
- 45+ comprehensive benchmark scenarios covering various query patterns
- Multi-field index benchmarks for compound query optimization
- Graceful handling of unsupported features across different Ditto versions

### Improved User Experience
- Configurable run counts for all benchmark commands
- Batch overwrite options when creating baselines (yes/no to all)
- Color-coded performance indicators for easy interpretation
- Table-based summary view for cross-version comparisons

### Version Compatibility
- Automatic version detection and feature compatibility checks
- DQL_STRICT_MODE automatically enabled only for Ditto 4.11.0+
- Baseline comparisons work seamlessly across different SDK versions

### Error Handling
- Benchmarks continue running even if individual queries fail
- Unsupported features are marked as "N/A" instead of stopping execution
- Cleanup queries run even after benchmark failures

## License

MIT