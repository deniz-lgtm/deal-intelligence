import { describe, it, expect } from 'vitest';
import { MetricExtractionService } from '../src/services/metric-extraction';
import { chunkText, smartChunkText, selectRelevantChunks } from '../src/services/chunking';

describe('MetricExtractionService', () => {
  const sampleText = `
Property Overview
123 Sunset Boulevard, Los Angeles, CA 90028
48 units | 52,000 SF | Built 1985 | Class B

Investment Highlights
Purchase Price: $12,500,000
Going-in Cap Rate: 4.5%
Current NOI: $562,500
Price per Unit: $260,417

Financial Summary
Year 1 NOI: $585,000
Projected IRR: 14.2%
Cash on Cash Return: 7.5%
Equity Multiple: 2.1x
Hold Period: 5 years

Market Analysis
Current Occupancy: 95%
Market Rent: $2,850/month
Rent Growth Assumption: 3.5% annually
  `;

  it('extracts property metrics', () => {
    const metrics = MetricExtractionService.extractMetrics(sampleText, 'test-doc');
    
    const units = metrics.find(m => m.metric_name === 'units');
    expect(units).toBeDefined();
    expect(units?.numeric_value).toBe(48);
    
    const sqft = metrics.find(m => m.metric_name === 'square_footage');
    expect(sqft).toBeDefined();
    expect(sqft?.numeric_value).toBe(52000);
    
    const year = metrics.find(m => m.metric_name === 'year_built');
    expect(year?.numeric_value).toBe(1985);
  });

  it('extracts financial metrics', () => {
    const metrics = MetricExtractionService.extractMetrics(sampleText, 'test-doc');
    
    const price = metrics.find(m => m.metric_name === 'purchase_price');
    expect(price?.numeric_value).toBe(12500000);
    
    const capRate = metrics.find(m => m.metric_name === 'cap_rate');
    expect(capRate?.numeric_value).toBe(0.045);
    
    const noi = metrics.find(m => m.metric_name === 'noi');
    expect(noi?.numeric_value).toBe(562500);
  });

  it('extracts IRR and returns', () => {
    const metrics = MetricExtractionService.extractMetrics(sampleText, 'test-doc');
    
    const irr = metrics.find(m => m.metric_name === 'irr');
    expect(irr?.numeric_value).toBe(0.142);
    
    const coc = metrics.find(m => m.metric_name === 'cash_on_cash');
    expect(coc?.numeric_value).toBe(0.075);
    
    const em = metrics.find(m => m.metric_name === 'equity_multiple');
    expect(em?.numeric_value).toBe(2.1);
  });
});

describe('ChunkingService', () => {
  const longText = `
Executive Summary
This is a summary of the investment opportunity. The property is located in a prime area.

Property Overview
Address: 123 Main St
The property features modern amenities and recent renovations.

Financial Analysis
The NOI is projected to grow by 3% annually.
This section contains detailed financial projections.

Market Analysis
The submarket has shown strong rent growth.
Demographics support continued demand.
  `.repeat(20); // Make it longer

  it('creates chunks from text', () => {
    const chunks = chunkText(longText, { chunkSize: 500 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toBeDefined();
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('selects relevant chunks for question', () => {
    const chunks = chunkText(longText);
    const relevant = selectRelevantChunks(chunks, 'What is the NOI?', 2);
    expect(relevant.length).toBeLessThanOrEqual(2);
  });
});
