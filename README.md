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

The terminal will automatically import the movie dataset on first run. If a `benchmark_baselines.ndjson` file exists in the root directory, it will also import baseline data.

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
- `.benchmark_baseline [runs]` - Create baselines for all benchmarks (default: 50 runs)
- `.benchmark_baseline <name> [runs]` - Create baseline for specific benchmark
- `.benchmark_show` - Display saved baseline comparison table
- `.system` - Display comprehensive system information including Ditto version, hardware details, and database statistics
- `.export <query>` - Export query results to `exports/export_<timestamp>.ndjson` file
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
.benchmark_baseline            # Create baseline for all benchmarks (50 runs)
.benchmark_baseline 100        # Create baseline for all with custom run count
.benchmark_baseline count      # Create baseline for specific benchmark
.benchmark_baseline count 100  # Create baseline for specific benchmark with custom runs
.benchmark_show                # Display saved baseline comparison table
```

When running benchmarks, the system automatically compares results against:
- The current version's baseline (if available)
- Last 3 patch versions (e.g., 4.12.0, 4.12.1, 4.12.2)
- Latest version from up to 2 previous minor versions (e.g., 4.11.5, 4.10.5)

Both `.benchmark_all` and `.benchmark_show` display comprehensive summary tables showing performance across versions with color-coded differences:
- 🟢 Green = Performance improvement (>1ms or >5% faster)
- 🔵 Blue = Minimal change (≤1ms or ≤5%)
- 🟡 Yellow = Small regression (1-2ms or 5-15% slower)
- 🔴 Red = Significant regression (>2ms or >15% slower)

**Baseline Data Import:**
If you have a `benchmark_baselines.ndjson` file in the root directory, the application will automatically import it on startup when the baseline collection is empty. This is useful for:
- Sharing baseline data between team members
- Restoring baseline data after database resets
- Setting up consistent baseline data across environments

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

### Saved Baselines

════════════════════════════════════════════════════════════════════════════════
SAVED BASELINES
════════════════════════════════════════════════════════════════════════════════

Benchmark Name               | 4.12.2 (current)|         4.12.1|         4.12.0 |         4.11.5 |         4.10.5 |          4.9.4
-|-|-|-|-|-|-
aggregation_avg_runtime      |           713.8 |  804.7 (-11%) |   713.9 (-0%)  |      -         |      -         |      -       
aggregation_count_by_rated   |           730.1 |   786.8 (-7%) |  657.8 (+11%)  |      -         |      -         |      -       
aggregation_count_by_year    |           732.4 |   754.9 (-3%) |   678.9 (+8%)  |      -         |      -         |      -       
array_field_query            |           716.9 |   758.4 (-5%) |   715.1 (+0%)  |      -         |      -         |      -       
complex_where_clause         |           700.9 |   729.7 (-4%) |   700.6 (+0%)  |   757.8 (-8%)  |  627.0 (+12%)  |  611.0 (+15%)
count                        |           738.3 |   736.1 (+0%) |   724.7 (+2%)  |      -         |      -         |      -       
count_with_condition         |           706.5 |   742.5 (-5%) |   715.3 (-1%)  |      -         |      -         |      -       
delete_single                |           434.3 |   413.0 (+5%) |   403.5 (+8%)  |   409.6 (+6%)  |   406.0 (+7%)  |   402.4 (+8%)
distinct_values              |           697.5 |   760.8 (-8%) |   720.1 (-3%)  |      -         |      -         |      -       
empty_result_set             |           658.0 |   720.4 (-9%) |   679.0 (-3%)  |  740.4 (-11%)  |   611.1 (+8%)  |   604.6 (+9%)
exact_match_id               |           688.6 |   727.5 (-5%) |   641.1 (+7%)  |   753.1 (-9%)  |  598.6 (+15%)  |   632.2 (+9%)
exact_match_runtime          |           639.2 |  717.8 (-11%) |   687.4 (-7%)  |  762.3 (-16%)  |   602.5 (+6%)  |   605.4 (+6%)
filtered_query_no_index      |           723.0 |   721.0 (+0%) |   710.1 (+2%)  |      -         |      -         |      -       
filtered_query_with_index    |            77.2 |    79.5 (-3%) |    80.1 (-4%)  |      -         |      -         |      -       
in_clause_large              |           685.3 |   734.6 (-7%) |   659.9 (+4%)  | 5292.4 (-87%)  |   638.1 (+7%)  |  625.6 (+10%)
in_clause_small              |           697.1 |   742.4 (-6%) |   694.6 (+0%)  |   768.9 (-9%)  |  619.5 (+13%)  |  607.1 (+15%)
insert                       |             2.0 |    2.0 (+0.0) |    2.4 (-0.4)  |    2.0 (+0.1)  |    2.1 (-0.0)  |    1.9 (+0.1)
large_text_search            |           662.9 |   721.2 (-8%) |   687.0 (-4%)  |   695.4 (-5%)  |   621.4 (+7%)  |   619.3 (+7%)
like_pattern                 |           688.5 |   743.8 (-7%) |   757.3 (-9%)  |  795.0 (-13%)  | 1045.0 (-34%)  |      -       
multi_field_filter           |           697.1 |   719.3 (-3%) |   717.9 (-3%)  |   695.0 (+0%)  |  607.1 (+15%)  |  604.7 (+15%)
multiple_and_conditions      |           697.5 |   720.7 (-3%) |   644.8 (+8%)  |   689.4 (+1%)  |  612.8 (+14%)  |  619.0 (+13%)
multiple_or_conditions       |           761.9 |   746.2 (+2%) |   728.9 (+5%)  |   729.7 (+4%)  |  639.8 (+19%)  |  639.1 (+19%)
nested_field_awards          |           719.2 |   725.8 (-1%) |   662.5 (+9%)  |  796.5 (-10%)  |  595.9 (+21%)  |  601.3 (+20%)
nested_field_awards_indexed  |           198.8 |   203.9 (-3%) |   198.6 (+0%)  |      -         |      -         |      -       
nested_field_imdb            |           697.7 |   726.6 (-4%) |   675.0 (+3%)  |   765.3 (-9%)  |  604.5 (+15%)  |  611.2 (+14%)
not_null_check               |           728.4 |  819.8 (-11%) |   757.4 (-4%)  |  820.3 (-11%)  |   673.7 (+8%)  |   668.9 (+9%)
null_check                   |           692.8 |   724.6 (-4%) |   658.7 (+5%)  |   732.3 (-5%)  |  603.8 (+15%)  |  604.2 (+15%)
range_query_runtime          |           714.6 |   756.3 (-6%) |   724.4 (-1%)  |   755.5 (-5%)  |  611.7 (+17%)  |  628.3 (+14%)
range_query_year             |           727.6 |   742.8 (-2%) |   736.6 (-1%)  |   732.2 (-1%)  |  599.8 (+21%)  |  632.7 (+15%)
range_query_year_indexed     |           724.0 |   754.9 (-4%) |   732.5 (-1%)  |      -         |      -         |      -       
select_100                   |             4.8 |    4.9 (-0.2) |    4.7 (+0.1)  |    4.7 (+0.0)  |    4.2 (+0.6)  |    4.2 (+0.6)
select_1000                  |            36.2 |   54.1 (-33%) |    33.4 (+8%)  |   54.5 (-34%)  |    35.6 (+2%)  |   30.3 (+19%)
select_10000                 |           334.3 |   351.7 (-5%) |   348.2 (-4%)  |   343.4 (-3%)  |  272.5 (+23%)  |  274.1 (+22%)
select_all                   |           812.2 |   799.9 (+2%) |   780.3 (+4%)  |   787.0 (+3%)  |  645.6 (+26%)  |  669.2 (+21%)
select_nested_fields         |            36.9 |    37.2 (-1%) |   31.9 (+16%)  |      -         |      -         |      -       
select_small                 |             2.3 |    1.9 (+0.4) |    1.9 (+0.5)  |    1.8 (+0.5)  |    1.7 (+0.6)  |    5.9 (-3.5)
select_specific_fields       |            39.2 |    37.8 (+4%) |   35.1 (+12%)  |      -         |      -         |      -       
single_result                |           688.9 |   715.8 (-4%) |   674.2 (+2%)  |   717.6 (-4%)  |  596.7 (+15%)  |  610.3 (+13%)
sort_by_runtime              |           679.5 |  767.1 (-11%) |   686.7 (-1%)  |  777.1 (-13%)  |   658.5 (+3%)  |   656.6 (+3%)
sort_by_year                 |           704.9 |   737.5 (-4%) |   691.6 (+2%)  |  838.0 (-16%)  |   655.1 (+8%)  |   655.5 (+8%)
sort_by_year_indexed         |           717.6 |   787.3 (-9%) |   715.6 (+0%)  |      -         |      -         |      -       
text_search_plot             |           711.2 |   736.1 (-3%) |   715.8 (-1%)  |   748.8 (-5%)  |  598.7 (+19%)  |  639.6 (+11%)
text_search_plot_indexed     |           703.4 |   724.9 (-3%) |   715.2 (-2%)  |      -         |      -         |      -       
text_search_title            |           698.0 |   708.2 (-1%) |   705.4 (-1%)  |   745.8 (-6%)  |  612.4 (+14%)  |  600.1 (+16%)
update_single                |           421.2 |   412.6 (+2%) |   406.9 (+4%)  |   398.1 (+6%)  |   403.3 (+4%)  |   401.7 (+5%)
year_filter_no_index         |           712.8 |   769.4 (-7%) |   704.0 (+1%)  |      -         |      -         |      -       
year_filter_with_index       |           702.1 |   770.1 (-9%) |   738.3 (-5%)  |      -         |      -         |      -      


## Benchmark Hardware Context

All benchmark results in this repository were collected on the following system:

```
System Information:
  Platform: darwin arm64
  OS Release: 24.6.0  

CPU Information:
  Model: Apple M1 Max
  Cores: 10
```

**Important Notes:**
- Benchmark results are highly dependent on hardware specifications
- Your results will vary based on CPU, memory, storage type, and system load
- Use relative performance comparisons (between versions) rather than absolute times
- The `.system` command shows your current hardware specifications for reference

When sharing benchmark results or comparing performance:
- Always include your system specifications (use `.system` command)
- Focus on percentage changes between versions rather than absolute timings
- Consider running multiple benchmark iterations to account for system variance
- Be aware that different CPU architectures (Intel vs ARM) will show different baseline performance

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

## Data Export

Export query results to NDJSON format for backup, analysis, or migration:

```
.export SELECT * FROM movies                           # Export all movies
.export SELECT * FROM movies WHERE rated = 'PG'       # Export filtered movies
.export SELECT * FROM benchmark_baselines             # Export baseline data
.export SELECT _id.title, runtime FROM movies LIMIT 100  # Export specific fields
```

The export command:
- Executes any valid DQL query
- Saves results in NDJSON (newline-delimited JSON) format
- Creates an `exports/` directory if it doesn't exist
- Generates timestamped filenames: `export_2024-10-04T09-30-15.ndjson`
- Places files in the `exports/` directory (ignored by git)
- Shows export statistics (document count, file size, location, query)
- Handles query errors gracefully

NDJSON format is ideal for:
- Data backups and archiving
- Importing into other systems
- Analysis with tools like `jq` or custom scripts
- Version control of dataset snapshots

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

## Key Features

### Comprehensive Benchmark Suite
- 45+ benchmark scenarios covering various query patterns and optimizations
- Multi-field index benchmarks for compound query testing
- INSERT, UPDATE, DELETE operations with proper cleanup
- Text search, range queries, aggregations, and sorting benchmarks
- Progress tracking shows current benchmark number (e.g., "Running benchmark (40/48)")

### Performance Baseline Tracking
- Create and save performance baselines across Ditto versions
- Individual baseline creation with `.benchmark_baseline <name> [runs]`
- Compare current performance against historical baselines
- Color-coded performance indicators for easy interpretation
- Table-based summary view for cross-version comparisons (up to 7 versions)
- `.benchmark_show` command to view saved baselines without running benchmarks

### Flexible Data Export
- Export any query results to NDJSON format with `.export <query>`
- Timestamped filenames prevent overwrites
- Organized in `exports/` directory (git-ignored)
- Perfect for data analysis, backup, or sharing

### Version Compatibility & Auto-Setup
- Automatic version detection and feature compatibility checks
- DQL_STRICT_MODE automatically enabled only for Ditto 4.11.0+
- USER_COLLECTION_SYNC_SCOPES for Ditto 4.10.0+
- COLLECTION schema syntax for older Ditto versions (<4.11.0)
- Auto-import of movies and baseline data on first run

### Robust Error Handling
- Benchmarks continue running even if individual queries fail
- Unsupported features are marked as "N/A" instead of stopping execution
- Cleanup queries run even after benchmark failures
- Graceful degradation for older Ditto versions
- TypeScript error handling for unknown error types

## License

MIT